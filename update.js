#!/usr/bin/env node

// Adapted from the fa-harness updater for a JavaScript service without builds or databases.
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, dirname, resolve as resolvePath } from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = dirname(fileURLToPath(import.meta.url));

export function parseArgs(values) {
  const options = { branch: 'master', services: ['fa-model-catalog'], check: false, force: false, help: false };
  let explicitService = false;
  const names = {
    '--branch': 'branch',
    '--service': 'services',
    '--health-url': 'healthUrl',
    '--server-config': 'serverConfig',
    '--revision': 'revision',
    '--repository': 'repository',
  };
  for (let i = 0; i < values.length; i++) {
    const value = values[i];
    if (value === '--help' || value === '-h') {
      options.help = true;
    } else if (value === '--check') {
      options.check = true;
    } else if (value === '--force' || value === '-f') {
      options.force = true;
    } else if (names[value]) {
      const next = values[++i];
      if (!next || next.startsWith('-')) {
        throw new Error(`A value is required after ${value}.`);
      }
      if (value === '--service') {
        if (!explicitService) {
          options.services = [];
          explicitService = true;
        }
        options.services.push(next);
      } else {
        options[names[value]] = next;
      }
    } else {
      throw new Error(`Unknown argument: ${value}`);
    }
  }
  return options;
}

export function validateOptions(options) {
  if (!/^[a-zA-Z0-9_][a-zA-Z0-9_/-]*$/.test(options.branch) || options.branch.includes('..')) {
    throw new Error('Invalid branch name.');
  }
  if (!options.services.length || options.services.some((name) => !/^[a-zA-Z0-9_-]+$/.test(name))) {
    throw new Error('Invalid service name.');
  }
  if (options.revision && !/^[a-f0-9]{40}$/.test(options.revision)) {
    throw new Error('A full Git commit identifier is required.');
  }
  if (!options.serverConfig) {
    throw new Error('--server-config is required.');
  }
  const health = new URL(options.healthUrl);
  if (health.protocol !== 'http:' || health.hostname !== '127.0.0.1' || health.pathname !== '/health') {
    throw new Error('Use the loopback /health endpoint for readiness.');
  }
}

export function classifyChanges(files) {
  const normalized = [...new Set(files.map((file) => file.replaceAll('\\', '/')).filter(Boolean))];
  return {
    dependencyChanges: normalized.some((file) => ['package.json', 'package-lock.json'].includes(file)),
    runtimeChanges: normalized.some((file) => file.startsWith('src/') && file.endsWith('.js')),
    files: normalized,
  };
}

export function mergeChanges(current, pending) {
  return {
    dependencyChanges: current.dependencyChanges || Boolean(pending?.dependencyChanges),
    runtimeChanges: current.runtimeChanges || Boolean(pending?.runtimeChanges),
    files: [...new Set([...current.files, ...(pending?.files || [])])],
  };
}

function execute(command, args, { inherit = false, allowFailure = false } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: inherit ? 'inherit' : ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    child.stdout?.on('data', (chunk) => {
      stdout += chunk;
    });
    child.stderr?.on('data', (chunk) => {
      stderr += chunk;
    });
    child.once('error', reject);
    child.once('close', (code) => {
      if (code !== 0 && !allowFailure) {
        reject(new Error(`${command} failed with code ${code}. ${stderr.trim()}`));
      } else {
        resolve({ code, stdout: stdout.trim(), stderr: stderr.trim() });
      }
    });
  });
}
const output = async (command, args) => (await execute(command, args)).stdout;
const run = (command, args) => {
  console.log(`> ${command} ${args.join(' ')}`);
  return execute(command, args, { inherit: true });
};
function systemctl(args, options = {}) {
  return process.getuid() === 0
    ? execute('systemctl', args, options)
    : execute('sudo', ['--non-interactive', 'systemctl', ...args], options);
}

async function validateRuntime(file) {
  try {
    const { readSettings } = await import('./src/settings.js');
    const { parseCatalog } = await import('./src/catalog-schemas.js');
    const { server: config } = await readSettings(file);
    parseCatalog(readFileSync(config.catalogFile, 'utf8'));
    return config;
  } catch {
    throw new Error('Runtime configuration, catalog, or access settings are invalid.');
  }
}

async function waitForHealth(url) {
  for (let attempt = 1; attempt <= 30; attempt++) {
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(2000), redirect: 'error' });
      if (response.ok && (await response.json()).status === 'ok') {
        console.log('Readiness confirmed.');
        return;
      }
    } catch {
      /* The service may still be starting. */
    }
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  throw new Error('Service readiness check failed.');
}

async function main() {
  process.chdir(projectRoot);
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    console.log(`Update fa-model-catalog from Git on a Linux systemd server.
Usage: ./update.js [--check] [-f|--force] --server-config <path> --health-url <loopback-url>
                   [--branch master] [--service fa-model-catalog] [--revision <commit>]
                   [--repository <url>]
Tracked server files are reset to the selected Git commit. Ignored settings and untracked data are preserved.
Dependencies are installed only when needed. Failed updates leave a pending marker for retry.
Use the deployment wrapper to supply these arguments from private settings.`);
    return;
  }
  if (process.platform !== 'linux') {
    throw new Error('This updater requires Linux and systemd.');
  }
  validateOptions(options);
  const pendingFile = join(projectRoot, '.runtime/update-pending.json');
  let stage = 'Fetching Git revision';
  let done = 0;
  const started = Date.now();
  const progress = () =>
    console.log(`${stage}: completed ${done}/4; elapsed ${((Date.now() - started) / 1000).toFixed(1)}s.`);
  const timer = setInterval(progress, 30000);
  try {
    if ((await output('git', ['rev-parse', '--show-toplevel'])) !== projectRoot) {
      throw new Error('Run the updater from its own Git checkout.');
    }
    if (options.repository && (await output('git', ['remote', 'get-url', 'origin'])) !== options.repository) {
      throw new Error('Unexpected Git repository.');
    }
    if ((await output('git', ['branch', '--show-current'])) !== options.branch) {
      throw new Error('Unexpected Git branch.');
    }
    await run('git', ['fetch', 'origin', options.branch, '--prune']);
    const before = await output('git', ['rev-parse', 'HEAD']);
    const remoteRef = `origin/${options.branch}`;
    const after = options.revision || (await output('git', ['rev-parse', remoteRef]));
    await execute('git', ['merge-base', '--is-ancestor', after, remoteRef]);
    const groups = await Promise.all([
      output('git', ['diff', '--name-only', 'HEAD', after]),
      output('git', ['diff', '--name-only']),
      output('git', ['diff', '--cached', '--name-only']),
    ]);
    let pending = null;
    if (existsSync(pendingFile)) {
      try {
        pending = JSON.parse(readFileSync(pendingFile, 'utf8'));
      } catch {
        pending = { dependencyChanges: true, runtimeChanges: true };
      }
    }
    const changes = mergeChanges(classifyChanges(groups.flatMap((group) => group.split(/\r?\n/))), pending);
    const dirty = Boolean(await output('git', ['status', '--porcelain', '--untracked-files=no']));
    const states = await Promise.all(
      options.services.map((service) => systemctl(['is-active', service], { allowFailure: true })),
    );
    console.log(`Git revision: ${before} -> ${after}; tracked changes: ${dirty}; pending retry: ${Boolean(pending)}.`);
    options.services.forEach((service, i) => console.log(`${service}: ${states[i].stdout || 'unknown'}`));
    if (options.check) {
      return;
    }
    if (before === after && !dirty && !pending && !options.force && states.every((state) => state.code === 0)) {
      await waitForHealth(options.healthUrl);
      console.log('Already synchronized and healthy.');
      return;
    }
    mkdirSync(dirname(pendingFile), { recursive: true });
    writeFileSync(pendingFile, `${JSON.stringify({ ...changes, before, after })}\n`, { mode: 0o600 });
    await run('git', ['reset', '--hard', after]);
    done++;
    stage = 'Installing dependencies and validating data';
    if (changes.dependencyChanges || !existsSync(join(projectRoot, 'node_modules'))) {
      await run('npm', ['ci', '--omit=dev', '--ignore-scripts', '--no-audit', '--no-fund']);
    }
    const config = await validateRuntime(options.serverConfig);
    const health = new URL(options.healthUrl);
    if (config.host !== health.hostname || config.port !== Number(health.port || 80)) {
      throw new Error('Health endpoint does not match the server configuration.');
    }
    done++;
    stage = 'Restarting the service';
    await systemctl(['daemon-reload'], { inherit: true });
    await systemctl(['restart', ...options.services], { inherit: true });
    done++;
    stage = 'Checking readiness';
    await waitForHealth(options.healthUrl);
    for (const service of options.services) {
      await systemctl(['is-active', service], { inherit: true });
    }
    rmSync(pendingFile);
    done++;
    progress();
  } catch (error) {
    for (const service of options.services) {
      await execute('journalctl', ['-u', service, '-n', '20', '--no-pager'], { inherit: true, allowFailure: true });
    }
    throw error;
  } finally {
    clearInterval(timer);
  }
}

if (process.argv[1] && resolvePath(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(`Update failed: ${error.message}`);
    process.exitCode = 1;
  });
}
