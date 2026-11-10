import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { parse, stringify } from 'yaml';
import { readSettings } from '../../src/settings.js';
import { createConfigAccessControl } from '../../src/access.js';
import { files } from '../helpers.js';

test('Application settings contain keys and resolve the catalog relative to config/local.yaml', async (t) => {
  const fixture = await files(t);
  const data = parse(await readFile(fixture.configFile, 'utf8'));
  data.server.catalogFile = '../catalog.yaml';
  await writeFile(fixture.configFile, stringify(data));
  const settings = await readSettings(fixture.configFile);
  assert.equal(settings.server.catalogFile.replaceAll('\\', '/'), fixture.catalogFile.replaceAll('\\', '/'));
  assert.equal(settings.access.token, fixture.token);
  for (const server of [
    { ...data.server, accessFile: '/etc/obsolete/access.yaml' },
    { ...data.server, reloadIntervalMs: 0 },
    { ...data.server, port: 0 },
  ]) {
    await writeFile(fixture.configFile, stringify({ ...data, server }));
    await assert.rejects(readSettings(fixture.configFile), (error) => !error.message.includes(fixture.token));
  }
});

test('Inline keys reload from application settings, retain valid keys on errors, and support revocation', async (t) => {
  const fixture = await files(t);
  const events = [];
  const access = createConfigAccessControl({
    access: fixture.access,
    configFile: fixture.configFile,
    reloadIntervalMs: 60000,
    onEvent: (event) => events.push(event),
  });
  t.after(() => access.stop());
  const request = (token) => ({ headers: { authorization: `Bearer ${token}` } });
  assert.throws(() => access.authenticate(request(fixture.token)));
  await access.load();
  access.authenticate(request(fixture.token));
  const settings = parse(await readFile(fixture.configFile, 'utf8'));
  settings.access.token = 'b'.repeat(43);
  await writeFile(fixture.configFile, stringify(settings));
  await access.reload();
  assert.throws(() => access.authenticate(request(fixture.token)));
  access.authenticate(request('b'.repeat(43)));
  await writeFile(fixture.configFile, 'access: [invalid');
  await assert.rejects(access.reload());
  access.authenticate(request('b'.repeat(43)));
  assert(!JSON.stringify(events).includes(fixture.token));
  settings.access.token = '';
  await writeFile(fixture.configFile, stringify(settings));
  await access.reload();
  assert.throws(() => access.authenticate(request('b'.repeat(43))));
  await assert.rejects(readSettings(fixture.configFile));
  access.stop();
  assert.throws(() => access.authenticate(request('b'.repeat(43))));
});
