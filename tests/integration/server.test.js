import { test } from 'node:test';
import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { stringify } from 'yaml';
import { createCatalogServer } from '../../src/server.js';
import { createCatalogClient } from '../../src/client.js';
import { calculatePrice } from '../../src/pricing.js';
import { files, catalog, model } from '../helpers.js';

test('Access control, batch responses, limits, and key reloading', async (t) => {
  const f = await files(t);
  const app = createCatalogServer(f);
  t.after(() => app.close());
  const address = await app.listen({ port: 0 });
  const base = `http://127.0.0.1:${address.port}`;
  const send = (body, token = f.token) =>
    fetch(`${base}/v1/models/resolve`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  assert.equal((await fetch(`${base}/health`)).status, 200);
  assert.equal((await send({ models: ['demo'] }, 'invalid')).status, 401);
  const rows = await (await send({ models: ['demo', 'missing', 'demo', 'example@developer'] })).json();
  assert.deepEqual(rows[0], rows[2]);
  assert.equal(rows[1].status, 'not_found');
  assert.equal(rows[3].canonicalName, 'demo');
  assert.equal(new Set(rows.map((r) => r.catalogVersion)).size, 1);
  for (const body of [
    { models: null },
    { models: [3] },
    { models: [''] },
    { models: ['a'.repeat(513)] },
    { models: Array(1001).fill('demo') },
    { models: [], unexpected: 1 },
  ]) {
    assert.equal((await send(body)).status, 400);
  }
  assert.deepEqual(await (await send({ models: [] })).json(), []);
  assert.equal((await send({ models: ['a'.repeat(270000)] })).status, 413);
  const next = 'b'.repeat(43);
  await writeFile(f.accessFile, stringify({ clients: [{ id: 'test', keys: [{ id: 'two', token: next }] }] }));
  await app.access.reload();
  assert.equal((await send({ models: [] })).status, 401);
  assert.equal((await send({ models: [] }, next)).status, 200);
  await writeFile(f.accessFile, 'clients: []');
  await app.access.reload();
  assert.equal((await send({ models: [] }, next)).status, 401);
});
test('Central price changes, client refresh, and immutable historical calculations', async (t) => {
  const f = await files(t);
  const app = createCatalogServer(f);
  t.after(() => app.close());
  const address = await app.listen({ port: 0 });
  const client = createCatalogClient({ baseUrl: `http://127.0.0.1:${address.port}`, token: f.token, models: ['demo'] });
  t.after(() => client.stop());
  await client.start();
  const usage = { unit: 'tokens', inputTokens: 1000, outputTokens: 0 };
  const before = calculatePrice((await client.get(['demo']))[0], usage);
  await writeFile(f.catalogFile, catalog({ demo: model({ inp: 8 }) }));
  await app.store.reload();
  await client.refresh();
  const after = calculatePrice((await client.get(['demo']))[0], usage);
  assert.equal(before.priceUsd, 0.002);
  assert.equal(after.priceUsd, 0.008);
  assert.notEqual(before.snapshot.catalogVersion, after.snapshot.catalogVersion);
  await writeFile(f.catalogFile, 'invalid');
  await assert.rejects(app.store.reload());
  await client.refresh();
  assert.equal(calculatePrice((await client.get(['demo']))[0], usage).priceUsd, 0.008);
  await app.close();
  await client.refresh();
  const stale = (await client.get(['demo']))[0];
  assert(stale.stale);
  assert.equal(stale.model.inp, 8);
});
test('An invalid initial load does not open the port', async (t) => {
  const f = await files(t);
  await writeFile(f.catalogFile, 'invalid');
  const app = createCatalogServer(f);
  await assert.rejects(app.listen({ port: 0 }));
  assert.equal(app.server.listening, false);
  await app.close();
});
