#!/usr/bin/env node
import fs from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { parse, stringify } from 'yaml';
import { parseCatalog } from '../../../../src/schemas/catalog.js';
import { parseAccessFile } from 'fa-web-access';

const command = process.argv[2] || 'status';
const settings = parse(await fs.readFile('.agents/skills/deploy/config/config.local.yaml', 'utf8'));
const config = settings.remote;
const accessText = stringify(settings.access);
parseAccessFile(accessText, { allowEmpty: true });
for (const key of ['host', 'publicHost', 'user']) {
  if (!/^[a-zA-Z0-9.-]+$/.test(config[key])) {
    throw new Error('Invalid connection settings.');
  }
}
if (
  !Number.isInteger(config.port) ||
  config.port < 1 ||
  config.port > 65535 ||
  typeof config.repository !== 'string' ||
  !/^(?:https:\/\/|git@)[a-zA-Z0-9._:/@-]+$/.test(config.repository)
) {
  throw new Error('Invalid connection settings.');
}
const options = ['-o', 'BatchMode=yes', '-o', 'ConnectTimeout=15', '-i', config.keyPath];
const destination = `${config.user}@${config.host}`;
const { appDirectory: app, serviceName: service, publicPort, tlsSnippet, branch } = settings.deployment;
const runtime = settings.server;
if (
  !/^\/[a-zA-Z0-9_./-]+$/.test(app) ||
  app.split('/').includes('..') ||
  !/^\/[a-zA-Z0-9_./-]+$/.test(tlsSnippet) ||
  tlsSnippet.split('/').includes('..') ||
  !/^[a-zA-Z0-9_-]+$/.test(service) ||
  !/^[a-zA-Z0-9_-][a-zA-Z0-9_/-]*$/.test(branch) ||
  !Number.isInteger(publicPort) ||
  publicPort < 1 ||
  publicPort > 65535 ||
  !Number.isInteger(runtime.port) ||
  runtime.port < 1 ||
  runtime.port > 65535 ||
  !/^127\.0\.0\.1$/.test(runtime.host)
) {
  throw new Error('Invalid deployment settings.');
}
const healthUrl = `http://${runtime.host}:${runtime.port}/health`;
if (command === 'deploy') {
  if (
    !runtime ||
    Object.keys(runtime).some(
      (key) => !['accessFile', 'catalogFile', 'host', 'port', 'reloadIntervalMs'].includes(key),
    ) ||
    runtime.accessFile !== `/etc/${service}/access.yaml` ||
    runtime.catalogFile !== `${app}/catalog.yaml` ||
    runtime.host !== '127.0.0.1' ||
    !Number.isFinite(runtime.reloadIntervalMs) ||
    runtime.reloadIntervalMs < 10
  ) {
    throw new Error('Application settings do not match the service deployment.');
  }
}
let done = 0;
let total = 1;
const started = Date.now();
let stage = 'Preparation';
const progress = () =>
  console.log(
    `${stage}: completed ${done}, remaining ${Math.max(0, total - done)}, rate ${(done / Math.max(1, (Date.now() - started) / 1000)).toFixed(3)} stages/s.`,
  );
const timer = setInterval(progress, 30000);
function run(bin, args, input = null) {
  return new Promise((resolve, reject) => {
    const child = spawn(bin, args, {
      stdio: [input === null ? 'ignore' : 'pipe', 'inherit', 'inherit'],
      windowsHide: true,
    });
    if (input !== null) {
      child.stdin.end(input);
    }
    child.once('error', reject);
    child.once('close', (code) => (code === 0 ? resolve() : reject(new Error(`Command exited with code ${code}.`))));
  });
}
async function ssh(script) {
  await run('ssh', [...options, '-p', String(config.port), destination, 'bash -se'], script);
}
async function step(name, fn) {
  stage = name;
  progress();
  await fn();
  done++;
  progress();
}
async function uploadText(text, remote) {
  await run('ssh', [...options, '-p', String(config.port), destination, `umask 077; cat > ${remote}`], text);
}
const state = `systemctl is-active ${service}; curl --fail --silent ${healthUrl}; printf '\\n'; journalctl -u ${service} -n 8 --no-pager`;
try {
  if (command === 'inspect') {
    await step('Checking the environment', () =>
      ssh(
        `hostname\nnode --version\ncommand -v nginx\nss -H -ltn sport = :${publicPort}\nss -H -ltn sport = :${runtime.port}\n`,
      ),
    );
  } else if (['status', 'logs', 'start', 'stop', 'restart'].includes(command)) {
    await step('Managing the service', () =>
      ssh(
        command === 'status'
          ? state
          : command === 'logs'
            ? `journalctl -u ${service} -n 40 --no-pager`
            : `systemctl ${command} ${service}\n${command === 'stop' ? `systemctl is-active ${service} || test $? -eq 3` : state}`,
      ),
    );
  } else if (['push-catalog', 'push-access'].includes(command)) {
    const isCatalog = command === 'push-catalog';
    const text = isCatalog ? await fs.readFile('catalog.yaml', 'utf8') : accessText;
    if (isCatalog) {
      parseCatalog(text);
    } else {
      parseAccessFile(text, { allowEmpty: true });
    }
    const temporary = `/tmp/fa-model-catalog-${randomUUID()}`;
    const target = isCatalog ? `${app}/catalog.yaml` : runtime.accessFile;
    try {
      await uploadText(text, temporary);
      await ssh(
        `install -o ${service} -g ${service} -m 600 ${temporary} ${target}.next\nmv ${target}.next ${target}\n`,
      );
    } finally {
      await ssh(`rm -f ${temporary}\n`);
    }
  } else if (['deploy', 'update'].includes(command)) {
    total = command === 'deploy' ? 5 : 2;
    if (command === 'deploy') {
      await step('Checking ports and the environment', () =>
        ssh(`if ! systemctl cat ${service} >/dev/null 2>&1; then
test -z "$(ss -H -ltn sport = :${publicPort})"
test -z "$(ss -H -ltn sport = :${runtime.port})"
fi
test -f ${tlsSnippet}
command -v node
command -v git
`),
      );
    }
    await step('Installing source code and dependencies', () =>
      ssh(`
if test ! -d ${app}/.git; then
  test ! -e ${app}
  git clone ${config.repository} ${app}
fi
test "$(git -C ${app} remote get-url origin)" = '${config.repository}'
git -C ${app} fetch origin ${branch}
git -C ${app} reset --hard origin/${branch}
cd ${app}
npm ci --omit=dev --ignore-scripts --no-audit --no-fund
`),
    );
    if (command === 'deploy') {
      await step('Installing persistent data', async () => {
        parseCatalog(await fs.readFile('catalog.example.yaml', 'utf8'));
        parseAccessFile(accessText);
        const temporary = `/tmp/fa-model-catalog-${randomUUID()}`;
        try {
          await uploadText(accessText, temporary);
          await ssh(`
id ${service} >/dev/null 2>&1 || useradd --system --home /var/lib/${service} --shell /usr/sbin/nologin ${service}
install -d -o ${service} -g ${service} -m 750 /var/lib/${service} /etc/${service}
if test ! -f ${app}/catalog.yaml; then install -o ${service} -g ${service} -m 600 ${app}/catalog.example.yaml ${app}/catalog.yaml; fi
if test ! -f /etc/${service}/access.yaml; then install -o ${service} -g ${service} -m 600 ${temporary} /etc/${service}/access.yaml; fi
install -d -m 755 /usr/local/lib/${service}
install -m 755 "$(command -v node)" /usr/local/lib/${service}/node
`);
        } finally {
          await ssh(`rm -f ${temporary}\n`);
        }
      });
      await step('Configuring the service and secure endpoint', async () => {
        const temporary = `/tmp/fa-model-catalog-${randomUUID()}`;
        try {
          await uploadText(stringify(settings.server), temporary);
          await ssh(`
install -o ${service} -g ${service} -m 600 ${temporary} /etc/${service}/server.yaml.next
mv /etc/${service}/server.yaml.next /etc/${service}/server.yaml
cat > /etc/systemd/system/${service}.service <<'UNIT'
[Unit]
Description=Model catalog and pricing service
After=network.target
[Service]
Type=simple
User=${service}
Group=${service}
WorkingDirectory=${app}
ExecStart=/usr/local/lib/${service}/node ${app}/src/cli/server.js --config /etc/${service}/server.yaml
Restart=on-failure
RestartSec=3
NoNewPrivileges=true
ProtectSystem=strict
ProtectHome=true
PrivateTmp=true
ReadOnlyPaths=/etc/${service} /var/lib/${service}
[Install]
WantedBy=multi-user.target
UNIT
cat > /etc/nginx/conf.d/${service}.conf <<'NGINX'
server {
    listen ${publicPort} ssl;
    server_name ${config.publicHost};
    include ${tlsSnippet};
    ssl_protocols TLSv1.2 TLSv1.3;
    client_max_body_size 256k;
    client_body_timeout 10s;
    location / {
        proxy_pass http://${runtime.host}:${runtime.port};
        proxy_set_header Host $host;
        proxy_set_header Authorization $http_authorization;
        proxy_connect_timeout 3s;
        proxy_read_timeout 15s;
    }
}
NGINX
nginx -t
systemctl daemon-reload
systemctl enable ${service}
`);
        } finally {
          await ssh(`rm -f ${temporary}\n`);
        }
      });
    }
    await step('Starting the service and checking readiness', () =>
      ssh(`systemctl restart ${service}
for attempt in 1 2 3 4 5 6 7 8 9 10; do
  if curl --fail --silent ${healthUrl}; then break; fi
  sleep 1
done
${command === 'deploy' ? 'systemctl reload nginx' : ''}
${state}
`),
    );
  } else {
    throw new Error('Unknown command.');
  }
} finally {
  clearInterval(timer);
}
