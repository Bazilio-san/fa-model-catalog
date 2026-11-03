import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { parseCatalog } from '../../src/schemas/catalog.js';
import { resolveModels, createCatalogStore } from '../../src/catalog.js';
import { catalog, model, files } from '../helpers.js';

test('Exact names, explicit references, and provider prefixes', () => {
  const data = parseCatalog(
    catalog({
      demo: model(),
      'openai/demo': 'demo',
      'finam@developer': 'demo',
      'finam@demo': model({ inp: 3 }),
      'demo-2026-03-05': 'demo',
    }),
  );
  const records = resolveModels(data, [
    'demo',
    'finam@demo',
    'finam@developer',
    'other@demo',
    'openai/demo',
    'unknown/demo',
    'demo-2026-03-05',
    'demo-2026-03-06',
    'constructor',
    'demo',
  ]);
  assert.equal(records[1].model.inp, 3);
  assert.equal(records[2].canonicalName, 'demo');
  assert.equal(records[3].matchedName, 'demo');
  assert.equal(records[4].canonicalName, 'demo');
  assert.equal(records[5].status, 'not_found');
  assert.equal(records[6].canonicalName, 'demo');
  assert.equal(records[7].status, 'not_found');
  assert.equal(records[8].status, 'not_found');
  assert.deepEqual(records[0], records[9]);
  assert(Object.isFrozen(records[0].model));
});
test('An invalid catalog is rejected in full', () => {
  for (const text of [
    catalog({ a: 'b', b: 'a' }),
    catalog({ a: 'missing' }),
    catalog({ a: model({ inp: -1 }) }),
    catalog({ a: model({ inp: Infinity }) }),
    catalog({ a: model({ unwanted: true }) }),
    catalog({ a: model({ inp: undefined }) }),
    'schemaVersion: 1\nschemaVersion: 1\n',
    'models: &x {a: *x}',
  ]) {
    assert.throws(() => parseCatalog(text));
  }
});
test('A stable version does not depend on key order', () => {
  const a = parseCatalog(catalog({ a: model(), b: 'a' }));
  const b = parseCatalog(catalog({ b: 'a', a: model() }));
  assert.equal(a.catalogVersion, b.catalogVersion);
});
test('An invalid update preserves the snapshot and a correction restores state', async (t) => {
  const fixture = await files(t);
  const store = createCatalogStore({ file: fixture.catalogFile });
  t.after(() => store.stop());
  await store.load();
  const first = store.snapshot;
  await writeFile(fixture.catalogFile, 'invalid');
  await assert.rejects(store.reload());
  assert.equal(store.snapshot, first);
  assert(store.error);
  await writeFile(fixture.catalogFile, catalog({ demo: model({ inp: 9 }) }));
  await store.reload();
  assert.equal(store.error, null);
  assert.equal(first.resolved.demo.model.inp, 2);
  assert.equal(store.snapshot.resolved.demo.model.inp, 9);
});
test('The catalog example contains all original names and dated references', async () => {
  const data = parseCatalog(await readFile('catalog.example.yaml', 'utf8'));
  assert(Object.keys(data.models).length >= 77);
  assert.equal(resolveModels(data, ['finam@developer'])[0].canonicalName, 'gpt-5.6-luna');
});
