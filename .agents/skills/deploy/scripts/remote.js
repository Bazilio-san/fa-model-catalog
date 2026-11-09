#!/usr/bin/env node
import fs from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { stringify } from 'yaml';
import { selectServer, loadSettings } from './settings.js';
import { parseCatalog } from '../../../../src/catalog-schemas.js';
import { parseAccessFile } from 'fa-web-access';

const root = fileURLToPath(new URL('../../../../', import.meta.url));
process.chdir(root);
const selection = selectServer(process.argv.slice(2));
const { command } = selection;
const commands = [
  'show',
  'inspect',
  'deploy',
  'update',
  'check',
  'status',
  'logs',
  'start',
  'stop',
  'restart',
  'push-catalog',
  'push-config',
  'verify',
];
if (!commands.includes(command)) {
  throw new Error(`Expected one command: ${commands.join(', ')}.`);
}
const settings = await loadSettings(selection);
const config = settings.remote;
const { deployment } = settings;
const runtime = settings.server;
const { appDirectory: app, serviceName: service, branch, nginxSite, nginxSnippet, publicPort } = deployment;
const validPath = (value) =>
  typeof value === 'string' && /^\/[a-zA-Z0-9_./-]+$/.test(value) && !value.split('/').includes('..');
for (const key of ['nginxSite', 'nginxSnippet', 'catalogSource']) {
  if (!deployment[key]) {
    throw new Error(`Missing deployment.${key} in the selected config.yaml.`);
  }
}
if (
  !config ||
  !['host', 'publicHost', 'user'].every(
    (key) => typeof config[key] === 'string' && /^[a-zA-Z0-9.-]+$/.test(config[key]),
  ) ||
  typeof config.keyPath !== 'string' ||
  !config.keyPath ||
  !Number.isInteger(config.port) ||
  config.port < 1 ||
  config.port > 65535 ||
  typeof config.repository !== 'string' ||
  !/^(?:https:\/\/|git@)[a-zA-Z0-9._:/@-]+$/.test(config.repository) ||
  !validPath(app) ||
  app.split('/').filter(Boolean).length < 3 ||
  !/^[a-zA-Z0-9_-]+$/.test(service) ||
  !/^[a-zA-Z0-9_][a-zA-Z0-9_/-]*$/.test(branch) ||
  branch.includes('..') ||
  !validPath(nginxSite) ||
  !nginxSite.startsWith('/etc/nginx/') ||
  nginxSnippet !== `/etc/nginx/snippets/${service}.conf` ||
  !Number.isInteger(publicPort) ||
  publicPort < 1 ||
  publicPort > 65535 ||
  !runtime ||
  runtime.host !== '127.0.0.1' ||
  !Number.isInteger(runtime.port) ||
  runtime.port < 1 ||
  runtime.port > 65535 ||
  runtime.catalogFile !== `${app}/catalog.yaml` ||
  !Number.isFinite(runtime.reloadIntervalMs) ||
  runtime.reloadIntervalMs < 10 ||
  Object.keys(runtime).some((key) => !['catalogFile', 'host', 'port', 'reloadIntervalMs'].includes(key)) ||
  typeof deployment.catalogSource !== 'string' ||
  !deployment.catalogSource
) {
  throw new Error('Invalid connection, deployment, or runtime settings.');
}
const healthUrl = `http://${runtime.host}:${runtime.port}/health`;
const publicOrigin = `https://${config.publicHost}${publicPort === 443 ? '' : `:${publicPort}`}`;
if (command === 'show') {
  console.log(
    JSON.stringify(
      {
        server: selection.name,
        host: config.host,
        port: config.port,
        branch,
        appDirectory: app,
        serviceName: service,
        healthUrl,
        publicOrigin,
        catalogSource: deployment.catalogSource,
        rulesFile: selection.rulesFile,
      },
      null,
      2,
    ),
  );
  process.exit(0);
}
const accessText = stringify(settings.access);
try {
  parseAccessFile(accessText);
} catch {
  throw new Error('Invalid private access settings.');
}
const runtimeText = stringify({ server: runtime, access: settings.access });
const runtimeFile = `${app}/config/local.yaml`;
const options = ['-o', 'BatchMode=yes', '-o', 'ConnectTimeout=15', '-i', config.keyPath, '-p', String(config.port)];
const destination = `${config.user}@${config.host}`;
const endpoint = `${publicOrigin}/v1/models/resolve`;
let stage = command;
let done = 0;
const started = Date.now();
const timer = setInterval(
  () => console.log(`${stage}: completed ${done} stages; elapsed ${((Date.now() - started) / 1000).toFixed(1)}s.`),
  30000,
);
function run(bin, args, input = null, capture = false) {
  return new Promise((resolve, reject) => {
    const child = spawn(bin, args, {
      stdio: [input === null ? 'ignore' : 'pipe', capture ? 'pipe' : 'inherit', 'inherit'],
      windowsHide: true,
    });
    let stdout = '';
    child.stdout?.on('data', (chunk) => {
      stdout += chunk;
    });
    child.stdin?.on('error', (error) => {
      if (error.code !== 'EPIPE') {
        reject(error);
      }
    });
    if (input !== null) {
      child.stdin.end(input);
    }
    child.once('error', reject);
    child.once('close', (code) =>
      code === 0 ? resolve(stdout.trim()) : reject(new Error(`${bin} failed with code ${code}.`)),
    );
  });
}
const ssh = (script, capture = false) =>
  run('ssh', [...options, destination, 'bash -se'], `set -euo pipefail\n${script}\n`, capture);
async function step(name, fn) {
  stage = name;
  console.log(`${name}...`);
  await fn();
  done++;
}
async function upload(text, target) {
  const temporary = `/tmp/${service}-${randomUUID()}`;
  try {
    await run('ssh', [...options, destination, `umask 077; cat > ${temporary}`], text);
    await ssh(`install -o ${service} -g ${service} -m 600 ${temporary} ${target}.next\nmv ${target}.next ${target}`);
  } finally {
    await ssh(`rm -f ${temporary}`);
  }
}
async function verify() {
  if (process.env.NODE_TLS_REJECT_UNAUTHORIZED === '0') {
    throw new Error('Public verification requires TLS certificate validation.');
  }
  await ssh(`systemctl is-active ${service}\ncurl --fail --silent ${healthUrl}`);
  const health = await fetch(`${publicOrigin}/model-catalog/health`, {
    signal: AbortSignal.timeout(15000),
    redirect: 'error',
  });
  if (!health.ok || (await health.json()).status !== 'ok') {
    throw new Error('Public readiness check failed.');
  }
  const request = {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ models: ['gpt-6-sol'] }),
    redirect: 'error',
  };
  const denied = await fetch(endpoint, { ...request, signal: AbortSignal.timeout(15000) });
  await denied.arrayBuffer();
  if (denied.status !== 401) {
    throw new Error(`Unauthenticated request returned ${denied.status}; expected 401.`);
  }
  const authorized = await fetch(endpoint, {
    ...request,
    signal: AbortSignal.timeout(15000),
    headers: { ...request.headers, Authorization: `Bearer ${settings.access.clients[0].keys[0].token}` },
  });
  if (!authorized.ok) {
    throw new Error(`Authenticated request returned ${authorized.status}.`);
  }
  const records = await authorized.json();
  if (!Array.isArray(records) || records.length !== 1 || records[0].status !== 'found' || !records[0].model) {
    throw new Error('Authenticated model retrieval failed.');
  }
  console.log(`Verified ${endpoint}: readiness 200, unauthenticated 401, authenticated model retrieval 200.`);
  await ssh(`journalctl -u ${service} -n 10 --no-pager`);
}

async function configureNginx() {
  const snippet = `# Managed by ${service}. Do not edit manually.
location = /v1/models/resolve {
    client_max_body_size 256k;
    client_body_timeout 10s;
    proxy_pass http://${runtime.host}:${runtime.port};
    proxy_set_header Host $host;
    proxy_set_header Authorization $http_authorization;
    proxy_connect_timeout 3s;
    proxy_read_timeout 15s;
}
location = /model-catalog/health {
    proxy_pass http://${runtime.host}:${runtime.port}/health;
    proxy_connect_timeout 3s;
    proxy_read_timeout 5s;
}
`;
  const payload = Buffer.from(
    JSON.stringify({
      site: nginxSite,
      snippet: nginxSnippet,
      content: snippet,
      host: config.publicHost,
      port: publicPort,
    }),
  ).toString('base64');
  await ssh(`python3 - <<'PY'
import base64, json, pathlib, re, subprocess
config = json.loads(base64.b64decode('${payload}'))
site = pathlib.Path(config['site'])
snippet = pathlib.Path(config['snippet'])
original = site.read_bytes()
old_snippet = snippet.read_bytes() if snippet.exists() else None
text = original.decode()
include = 'include ' + str(snippet) + ';'
# Select the existing HTTPS server block, not the HTTP redirect block.
blocks = []
masked = re.sub(r'#[^\\n]*', lambda match: ' ' * len(match[0]), text)
for match in re.finditer(r'\\bserver\\s*\\{', masked):
    depth, end = 1, match.end()
    while end < len(masked) and depth:
        depth += (masked[end] == '{') - (masked[end] == '}')
        end += 1
    block = masked[match.end():end-1]
    names = re.search(r'\\bserver_name\\s+([^;]+);', block)
    listening = re.search(r'\\blisten\\s+(?:[0-9.]+:)?' + str(config['port']) + r'\\b[^;]*\\bssl\\b', block)
    if names and config['host'] in names[1].split() and listening:
        blocks.append((match.end() + names.end(), block))
if len(blocks) != 1:
    raise SystemExit('Expected exactly one existing HTTPS server for the configured hostname and port.')
if include not in blocks[0][1]:
    at = blocks[0][0]
    text = text[:at] + '\\n    ' + include + text[at:]
try:
    snippet.parent.mkdir(parents=True, exist_ok=True)
    snippet.write_text(config['content'])
    site.write_text(text)
    subprocess.run(['nginx', '-t'], check=True)
    subprocess.run(['systemctl', 'reload', 'nginx'], check=True)
except BaseException:
    site.write_bytes(original)
    if old_snippet is None:
        snippet.unlink(missing_ok=True)
    else:
        snippet.write_bytes(old_snippet)
    raise
PY`);
}

async function selectRevision() {
  await run('git', ['diff', '--quiet']);
  await run('git', ['diff', '--cached', '--quiet']);
  const untracked = await run(
    'git',
    ['ls-files', '--others', '--exclude-standard', 'src', 'update.js', '.agents/skills/deploy/scripts'],
    null,
    true,
  );
  if (untracked) {
    throw new Error('Commit new source and deployment files before deploying.');
  }
  const revision = await run('git', ['rev-parse', 'HEAD'], null, true);
  if (!/^[a-f0-9]{40}$/.test(revision)) {
    throw new Error('Invalid local Git revision.');
  }
  await run('git', ['fetch', 'origin', branch]);
  await run('git', ['merge-base', '--is-ancestor', revision, `origin/${branch}`]);
  return revision;
}
let selectedRevision;
async function synchronize(force = false, check = false) {
  const revision = selectedRevision;
  await ssh(`test "$(git -C ${app} remote get-url origin)" = '${config.repository}'
git -C ${app} fetch origin ${branch}
git -C ${app} merge-base --is-ancestor ${revision} origin/${branch}
${
  check
    ? ''
    : `git -C ${app} show ${revision}:update.js > ${app}/update.js.next
chmod 755 ${app}/update.js.next
mv ${app}/update.js.next ${app}/update.js`
}
cd ${app}
flock -n /run/lock/${service}-update.lock node update.js ${force ? '-f' : ''} ${check ? '--check' : ''} --branch ${branch} --service ${service} --server-config ${runtimeFile} --health-url ${healthUrl} --revision ${revision} --repository '${config.repository}'
`);
  console.log(`Selected Git revision: ${revision}`);
}

try {
  if (['deploy', 'update', 'restart', 'start', 'check', 'push-config'].includes(command)) {
    selectedRevision = await selectRevision();
  }
  if (command === 'inspect') {
    await ssh(
      `hostname\nnode --version\ncommand -v nginx\ncommand -v python3\ncommand -v flock\ntest -f ${nginxSite}\nss -H -ltn sport = :${runtime.port}`,
    );
  } else if (command === 'verify') {
    await verify();
  } else if (command === 'status' || command === 'logs') {
    await ssh(
      command === 'logs'
        ? `journalctl -u ${service} -n 40 --no-pager`
        : `systemctl is-active ${service}\ncurl --fail --silent ${healthUrl}\nprintf '\\n'\ngit -C ${app} rev-parse HEAD\njournalctl -u ${service} -n 10 --no-pager`,
    );
  } else if (command === 'stop') {
    await ssh(`systemctl stop ${service}\ntest "$(systemctl is-active ${service})" = inactive`);
  } else if (command === 'push-catalog') {
    const text = await fs.readFile(resolve(deployment.catalogSource), 'utf8');
    parseCatalog(text);
    await upload(text, runtime.catalogFile);
  } else if (command === 'check') {
    await synchronize(false, true);
  } else if (['update', 'restart', 'start'].includes(command)) {
    await step('Synchronizing from Git through update.js', () => synchronize(command !== 'update'));
    await verify();
  } else if (command === 'push-config') {
    await upload(runtimeText, runtimeFile);
    await configureNginx();
    await synchronize(true);
    await verify();
  } else if (command === 'deploy') {
    const catalogText = await fs.readFile(resolve(deployment.catalogSource), 'utf8');
    parseCatalog(catalogText);
    await step('Inspecting target and provisioning checkout', () =>
      ssh(`
hostname
node --version
command -v git
command -v nginx
command -v python3
command -v flock
test -f ${nginxSite}
if ! systemctl cat ${service} >/dev/null 2>&1; then
  test -z "$(ss -H -ltn sport = :${runtime.port})"
fi
if test ! -d ${app}/.git; then
  test ! -e ${app}
  git clone --branch ${branch} '${config.repository}' ${app}
fi
test "$(git -C ${app} remote get-url origin)" = '${config.repository}'
id ${service} >/dev/null 2>&1 || useradd --system --home /var/lib/${service} --shell /usr/sbin/nologin ${service}
install -d -o ${service} -g ${service} -m 750 ${app}/config /var/lib/${service}
install -d -m 755 /usr/local/lib/${service}
install -m 755 "$(command -v node)" /usr/local/lib/${service}/node
/usr/local/lib/${service}/node --input-type=module -e 'if(Number(process.versions.node.split(".")[0])<22)process.exit(1)'
`),
    );
    await step('Installing persistent data and runtime settings', async () => {
      const exists = await ssh(`test -f ${runtime.catalogFile} && echo yes || echo no`, true);
      if (exists === 'no') {
        await upload(catalogText, runtime.catalogFile);
      }
      await upload(runtimeText, runtimeFile);
    });
    await step('Installing the systemd unit', () =>
      ssh(`cat > /etc/systemd/system/${service}.service <<'UNIT'
[Unit]
Description=Model catalog and pricing service
After=network.target
[Service]
Type=simple
User=${service}
Group=${service}
WorkingDirectory=${app}
ExecStart=/usr/local/lib/${service}/node ${app}/src/cli/server.js --config ${runtimeFile}
Restart=on-failure
RestartSec=3
TimeoutStopSec=20
NoNewPrivileges=true
ProtectSystem=strict
ProtectHome=true
PrivateTmp=true
ReadOnlyPaths=${app}/config /var/lib/${service}
[Install]
WantedBy=multi-user.target
UNIT
systemctl daemon-reload
systemctl enable ${service}`),
    );
    await step('Synchronizing from Git and starting the service', () => synchronize(true));
    await step('Configuring the existing HTTPS site', configureNginx);
    await step('Verifying the public endpoint', verify);
  }
} finally {
  clearInterval(timer);
}
