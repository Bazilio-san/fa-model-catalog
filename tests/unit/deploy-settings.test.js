import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { stringify, parse } from 'yaml';
import { selectServer, loadSettings } from '../../.agents/skills/deploy/scripts/settings.js';

test('Deployment requires one explicit server and command, with no legacy config selection', () => {
  for (const args of [
    ['status'],
    ['--server', 'prod-1'],
    ['--server', '../prod-1', 'status'],
    ['--server', '_example', 'show'],
    ['--server', 'a/b', 'status'],
    ['--server', 'prod-1', '--server', 'prod-2', 'stop'],
    ['--config', 'private.yaml', 'stop'],
    ['--server', 'prod-1', 'status', 'stop'],
  ]) {
    assert.throws(() => selectServer(args));
  }
  assert.equal(selectServer(['show', '--server', 'prod-2']).name, 'prod-2');
});

test('Installation settings stay separate and require all three files', async (t) => {
  const directory = await fs.mkdtemp(resolve(tmpdir(), 'catalog-deploy-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  for (const name of ['first', 'second']) {
    const folder = resolve(directory, name);
    await fs.mkdir(folder);
    await fs.writeFile(resolve(folder, 'config.yaml'), stringify({ remote: { host: name }, deployment: {} }));
    await fs.writeFile(resolve(folder, 'local.yaml'), stringify({ access: { marker: name }, server: {} }));
    await fs.writeFile(resolve(folder, 'rules.md'), `Rules for ${name}.`);
  }
  const first = selectServer(['--server', 'first', 'show'], directory);
  const second = selectServer(['--server', 'second', 'show'], directory);
  assert.equal((await loadSettings(first)).remote.host, 'first');
  assert.equal((await loadSettings(second)).access.marker, 'second');
  await fs.unlink(second.rulesFile);
  await assert.rejects(loadSettings(second), /rules.md/);
  await fs.writeFile(resolve(first.configDirectory, 'local.yaml'), 'access: {}\nserver: {}\nremote: {}\n');
  await assert.rejects(loadSettings(first), /required sections/);
  await fs.writeFile(resolve(first.configDirectory, 'local.yaml'), 'access: {}\nserver: {}\nserver: {}\n');
  await assert.rejects(loadSettings(first), /Invalid local.yaml/);
});

test('Show runs from another directory without connections or exposing access keys', async (t) => {
  const name = `test-${process.pid}-${Date.now()}`;
  const folder = resolve('.agents/skills/deploy/configs', name);
  const example = resolve('.agents/skills/deploy/configs/_example');
  await fs.cp(example, folder, { recursive: true });
  t.after(() => fs.rm(folder, { recursive: true, force: true }));
  const settings = parse(await fs.readFile(resolve(folder, 'local.yaml'), 'utf8'));
  const token = 'PRIVATE_TOKEN_MUST_NOT_APPEAR';
  settings.access.token = token;
  await fs.writeFile(resolve(folder, 'local.yaml'), stringify(settings));
  const result = spawnSync(
    process.execPath,
    [resolve('.agents/skills/deploy/scripts/remote.js'), '--server', name, 'show'],
    { cwd: tmpdir(), encoding: 'utf8', windowsHide: true },
  );
  assert.equal(result.status, 0, result.stderr);
  assert(!result.stdout.includes(token));
  assert(!result.stdout.includes('keyPath'));
  const shown = JSON.parse(result.stdout);
  assert.equal(shown.server, name);
  assert.equal(shown.host, 'server.example.com');
  assert.equal(shown.serviceName, 'fa-model-catalog');
  assert.equal(shown.publicOrigin, 'https://catalog.example.com');
  const configFile = resolve(folder, 'config.yaml');
  const config = parse(await fs.readFile(configFile, 'utf8'));
  for (const port of [8443, 0, 65536]) {
    config.deployment.publicPort = port;
    await fs.writeFile(configFile, stringify(config));
    const custom = spawnSync(
      process.execPath,
      [resolve('.agents/skills/deploy/scripts/remote.js'), '--server', name, 'show'],
      { cwd: tmpdir(), encoding: 'utf8', windowsHide: true },
    );
    if (port === 8443) {
      assert.equal(custom.status, 0, custom.stderr);
      assert.equal(JSON.parse(custom.stdout).publicOrigin, 'https://catalog.example.com:8443');
    } else {
      assert.notEqual(custom.status, 0);
      assert.match(custom.stderr, /Invalid connection/);
    }
  }
});
