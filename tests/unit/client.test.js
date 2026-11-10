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

const endpoints = [
  { baseUrl: 'https://primary.example.com/catalog', token: 'primary-token' },
  { baseUrl: 'https://backup.example.com', token: 'backup-token' },
];

function setupFailover(overrides = {}) {
  return setup({ baseUrl: undefined, token: undefined, endpoints, ...overrides });
}

test('Temporary failures try endpoints in order with their own tokens and fresh timeouts', async (t) => {
  for (const failure of ['network', 'timeout', 429, 500, 502, 503, 504]) {
    const calls = [];
    const events = [];
    const s = setupFailover({
      timeoutMs: 10,
      onEvent: (event) => events.push(event),
      fetch: async (url, options) => {
        calls.push({ url: url.href, ...options });
        if (url.hostname === 'primary.example.com') {
          if (failure === 'network') {
            throw new Error('private transport details');
          }
          if (failure === 'timeout') {
            // Keep the event loop alive while the client's unreferenced timeout expires.
            await new Promise((resolve, reject) => {
              const keepAlive = setTimeout(resolve, 1000);
              options.signal.addEventListener(
                'abort',
                () => {
                  clearTimeout(keepAlive);
                  reject(options.signal.reason);
                },
                { once: true },
              );
            });
          }
          return new Response(null, { status: failure });
        }
        assert.equal(options.signal.aborted, false);
        return Response.json(resolveModels(parseCatalog(catalog()), JSON.parse(options.body).models));
      },
    });
    t.after(() => s.client.stop());
    await s.client.start();
    assert.deepEqual(
      calls.map((call) => call.url),
      ['https://primary.example.com/catalog/v1/models/resolve', 'https://backup.example.com/v1/models/resolve'],
    );
    assert.deepEqual(
      calls.map((call) => call.headers.Authorization),
      ['Bearer primary-token', 'Bearer backup-token'],
    );
    assert.equal(calls[0].body, calls[1].body);
    assert.equal(calls[1].redirect, 'error');
    assert.notEqual(calls[0].signal, calls[1].signal);
    assert.equal((await s.client.get(['demo']))[0].status, 'found');
    assert.deepEqual(
      events.map((event) => event.event),
      ['prices_received'],
    );
    assert.equal(s.timers.size, 1);
    await s.client.refresh();
    assert.equal(calls[2].url, calls[0].url);
  }
});

test('Permanent errors stop failover without scheduling retries', async (t) => {
  for (const failure of [400, 401, 403, 404, 'invalid', 'json']) {
    let calls = 0;
    const s = setupFailover({
      fetch: async () => {
        calls++;
        if (failure === 'invalid') {
          return Response.json([{ secret: 'hidden' }]);
        }
        if (failure === 'json') {
          return new Response('invalid JSON');
        }
        return new Response(null, { status: failure });
      },
    });
    t.after(() => s.client.stop());
    await s.client.start();
    assert.equal(calls, 1);
    assert.equal(s.timers.size, 1);
    assert.equal((await s.client.get(['demo']))[0].status, 'unavailable');
  }
});

test('Exhausting endpoints preserves cached data and respects the longest Retry-After', async (t) => {
  let failing = false;
  let calls = 0;
  const events = [];
  const s = setupFailover({
    onEvent: (event) => events.push(event),
    fetch: async (url, options) => {
      calls++;
      if (!failing) {
        return Response.json(resolveModels(parseCatalog(catalog()), JSON.parse(options.body).models));
      }
      if (url.hostname === 'primary.example.com') {
        return new Response(null, { status: 503, headers: { 'Retry-After': '1800' } });
      }
      throw new Error('backup-token');
    },
  });
  t.after(() => s.client.stop());
  await s.client.start();
  failing = true;
  await s.client.refresh();
  assert.equal(calls, 3);
  const record = (await s.client.get(['demo']))[0];
  assert.equal(record.model.inp, 2);
  assert.equal(record.stale, true);
  assert.equal(events.filter((event) => event.event === 'prices_unavailable').length, 1);
  assert(!JSON.stringify(events).includes('backup-token'));
  assert([...s.timers.values()].some((timer) => timer.delay === 1800000));
  assert.equal((await s.client.get(['unknown']))[0].status, 'unavailable');
});

test('Stopping during an attempt aborts it without contacting another endpoint', async () => {
  let calls = 0;
  const s = setupFailover({
    fetch: async (_url, options) => {
      calls++;
      return new Promise((_resolve, reject) => {
        options.signal.addEventListener('abort', () => reject(options.signal.reason), { once: true });
        queueMicrotask(() => s.client.stop());
      });
    },
  });
  await s.client.start();
  assert.equal(calls, 1);
  assert.equal(s.timers.size, 0);
});

test('Endpoint settings reject empty, ambiguous, and unsafe configurations', () => {
  const sparse = [];
  sparse.length = 1;
  for (const value of [
    null,
    [],
    {},
    [null],
    sparse,
    [{ baseUrl: endpoints[0].baseUrl }],
    [endpoints[0], { baseUrl: 'http://remote.example.com', token: 'x' }],
    [{ baseUrl: endpoints[0].baseUrl, token: 'x\n' }],
  ]) {
    assert.throws(() => setupFailover({ endpoints: value }));
  }
  assert.throws(() => setup({ endpoints }));
});
