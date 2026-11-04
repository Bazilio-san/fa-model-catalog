import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createCatalogClient } from '../../src/client.js';
import { parseCatalog } from '../../src/catalog-schemas.js';
import { resolveModels } from '../../src/catalog.js';
import { nextRefreshTime } from '../../src/schedule.js';
import { catalog } from '../helpers.js';

function setup(overrides = {}) {
  const timers = new Map();
  let next = 0;
  let clock = Date.parse('2026-11-03T00:00:00+03:00');
  let requests = 0;
  let mode = 'ok';
  const snapshot = parseCatalog(catalog());
  const client = createCatalogClient({
    baseUrl: 'http://localhost:3000',
    token: 'test',
    models: ['demo'],
    random: () => 0.5,
    now: () => clock,
    setTimer: (fn, delay) => {
      const id = ++next;
      timers.set(id, { fn, delay });
      return id;
    },
    clearTimer: (id) => timers.delete(id),
    fetch: async (_url, options) => {
      requests++;
      if (mode === 'network') {
        throw new Error('token=test');
      }
      if (mode === 'invalid') {
        return Response.json([{ secret: 'test' }]);
      }
      if (mode === 'forbidden') {
        return new Response(null, { status: 401 });
      }
      return Response.json(resolveModels(snapshot, JSON.parse(options.body).models));
    },
    ...overrides,
  });
  return {
    client,
    timers,
    get requests() {
      return requests;
    },
    set mode(value) {
      mode = value;
    },
    set clock(value) {
      clock = value;
    },
  };
}
test('Two refresh windows and random boundaries in an explicit time zone', () => {
  const now = Date.parse('2026-11-03T00:00:00+03:00');
  assert.equal(nextRefreshTime({ now, random: () => 0 }).time, Date.parse('2026-11-03T00:40:00+03:00'));
  assert.equal(nextRefreshTime({ now, random: () => 0.999999999 }).time, Date.parse('2026-11-03T01:20:00+03:00'));
  assert.equal(
    nextRefreshTime({ now: Date.parse('2026-11-03T02:00:00+03:00'), random: () => 0.5 }).time,
    Date.parse('2026-11-03T13:00:00+03:00'),
  );
  assert.equal(
    nextRefreshTime({ now: Date.parse('2026-11-03T23:00:00+03:00'), random: () => 0.5 }).time,
    Date.parse('2026-11-04T01:00:00+03:00'),
  );
  const one = nextRefreshTime({ now, random: () => 0.5 });
  assert.equal(
    nextRefreshTime({ now, random: () => 0.5, afterWindow: one.windowId }).time,
    Date.parse('2026-11-03T13:00:00+03:00'),
  );
  assert.throws(() => nextRefreshTime({ now, timezone: 'invalid' }));
});
test('Caching, request coalescing, negative responses, and manual refresh', async (t) => {
  const s = setup();
  t.after(() => s.client.stop());
  await s.client.start();
  assert.equal(s.requests, 1);
  await s.client.get(['demo', 'demo']);
  assert.equal(s.requests, 1);
  await Promise.all([s.client.get(['unknown']), s.client.get(['unknown']), s.client.get(['other'])]);
  assert.equal(s.requests, 2);
  assert.equal((await s.client.get(['unknown']))[0].status, 'not_found');
  assert.equal(s.requests, 2);
  await Promise.all([s.client.refresh(), s.client.refresh()]);
  assert.equal(s.requests, 3);
  const records = await s.client.get(['demo']);
  records[0].model.inp = 99;
  assert.equal((await s.client.get(['demo']))[0].model.inp, 2);
});
test('A failure preserves pricing, limits retries, and hides transport details', async (t) => {
  const s = setup();
  t.after(() => s.client.stop());
  await s.client.start();
  s.mode = 'network';
  await s.client.refresh();
  const old = (await s.client.get(['demo']))[0];
  assert.equal(old.model.inp, 2);
  assert(old.stale);
  assert(!old.reason.includes('test'));
  let retry = [...s.timers.values()].find((r) => r.delay === 300000);
  assert(retry);
  await retry.fn();
  retry = [...s.timers.values()].find((r) => r.delay === 1200000);
  assert(retry);
  await retry.fn();
  const count = s.requests;
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(s.requests, count);
  s.mode = 'ok';
  await s.client.refresh();
  assert.equal((await s.client.get(['demo']))[0].stale, false);
});
test('Access denial and invalid responses are not treated as missing models', async (t) => {
  for (const mode of ['forbidden', 'invalid']) {
    const s = setup();
    t.after(() => s.client.stop());
    s.mode = mode;
    await s.client.start();
    assert.equal((await s.client.get(['demo']))[0].status, 'unavailable');
    assert.equal(s.timers.size, 1);
  }
});
test('A single poll after sleep and timer cleanup on stop', async () => {
  const s = setup();
  await s.client.start();
  const timer = [...s.timers.values()][0];
  s.clock = Date.parse('2026-11-05T15:00:00+03:00');
  await timer.fn();
  assert.equal(s.requests, 2);
  assert.equal(s.client.nextRefreshAt, '2026-11-05T22:00:00.000Z');
  s.client.stop();
  await assert.rejects(s.client.get(['demo']));
  await assert.rejects(s.client.start());
});
test('Remote connections require a secure URL', () => {
  assert.throws(() => createCatalogClient({ baseUrl: 'http://example.com', token: 'x' }));
  assert.throws(() => createCatalogClient({ baseUrl: 'https://example.com', token: 'x\n' }));
});
