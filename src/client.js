import { validateModel } from './schemas/catalog.js';
import { nextRefreshTime } from './schedule.js';

export function createCatalogClient({
  baseUrl,
  token,
  models = [],
  timezone = 'Europe/Moscow',
  timeoutMs = 10000,
  fetch: fetcher = globalThis.fetch,
  now = Date.now,
  random = Math.random,
  setTimer = setTimeout,
  clearTimer = clearTimeout,
  onEvent = () => {},
}) {
  const url = new URL(baseUrl);
  if (url.username || url.password || url.search || url.hash || !['http:', 'https:'].includes(url.protocol)) {
    throw new Error('Invalid service URL.');
  }
  if (url.protocol !== 'https:' && !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)) {
    throw new Error('HTTPS is required for a remote service.');
  }
  if (typeof token !== 'string' || !token || /[\r\n]/.test(token) || !Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    throw new Error('Invalid client settings.');
  }
  new Intl.DateTimeFormat('en', { timeZone: timezone }).format();
  const cache = new Map();
  const wanted = new Set();
  const pending = new Map();
  const queued = new Set();
  const controllers = new Set();
  let active = false;
  let stopped = false;
  let flushQueued = false;
  let serial = Promise.resolve();
  let scheduleTimer;
  let retryTimer;
  let retryCount = 0;
  let refreshPromise;
  let lastWindow = null;
  let nextScheduledAt = null;
  const emit = (e) => {
    try {
      onEvent(e);
    } catch {
      /* Observer cannot change results. */
    }
  };
  const checkNames = (names) => {
    if (!Array.isArray(names) || names.some((n) => typeof n !== 'string' || !n.length || n.length > 512)) {
      throw new Error('Expected an array of nonempty names, each up to 512 characters long.');
    }
  };
  checkNames(models);
  models.forEach((n) => wanted.add(n));
  const result = (name) =>
    structuredClone(
      cache.get(name) ?? {
        requestedName: name,
        matchedName: null,
        canonicalName: null,
        status: 'unavailable',
        model: null,
        catalogVersion: null,
        stale: false,
        lastSuccessAt: null,
        reason: 'Data has not been received yet.',
      },
    );
  const planRetry = (waitMs = 0) => {
    if (!active || retryTimer || retryCount >= 2) {
      return;
    }
    const base = [300000, 1200000][retryCount++];
    const delay = Math.max(waitMs, base * (0.8 + random() * 0.4));
    retryTimer = setTimer(() => {
      retryTimer = null;
      return refreshInternal(false);
    }, delay);
    retryTimer.unref?.();
  };
  const request = async (names) => {
    if (stopped) {
      return;
    }
    const controller = new AbortController();
    controllers.add(controller);
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    timeout.unref?.();
    try {
      const response = await fetcher(
        new URL('v1/models/resolve', url.href.endsWith('/') ? url : new URL(`${url.href}/`)),
        {
          method: 'POST',
          headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ models: names }),
          signal: controller.signal,
          redirect: 'error',
        },
      );
      if (!response.ok) {
        const retryAfter = response.headers.get('retry-after');
        const retrySeconds =
          retryAfter && /^\d+$/.test(retryAfter)
            ? Number(retryAfter) * 1000
            : retryAfter
              ? Math.max(0, Date.parse(retryAfter) - now())
              : 0;
        throw Object.assign(new Error(), {
          status: response.status,
          retryAfter: Number.isFinite(retrySeconds) ? retrySeconds : 0,
        });
      }
      const text = await readBounded(response, 8 * 1024 * 1024);
      const data = JSON.parse(text);
      if (
        !Array.isArray(data) ||
        data.length !== names.length ||
        data.some((r, i) => !validRecord(r, names[i])) ||
        new Set(data.map((r) => r.catalogVersion)).size > 1
      ) {
        throw Object.assign(new Error(), { status: 400, invalidResponse: true });
      }
      if (stopped) {
        return;
      }
      const success = new Date(now()).toISOString();
      data.forEach((r) => cache.set(r.requestedName, { ...r, stale: false, lastSuccessAt: success, reason: null }));
      emit({ event: 'prices_received', count: data.length, catalogVersion: data[0]?.catalogVersion ?? null });
    } catch (e) {
      if (stopped) {
        return;
      }
      const reason = e.invalidResponse
        ? 'The service returned invalid data.'
        : e.status === 401 || e.status === 403
          ? 'The service denied access.'
          : e.status
            ? `Could not retrieve prices; response status ${e.status}.`
            : 'The service is unavailable or the request timed out.';
      names.forEach((name) => {
        const old = result(name);
        cache.set(name, { ...old, stale: old.lastSuccessAt !== null, reason });
      });
      emit({ event: 'prices_unavailable', count: names.length, reason });
      if (!e.status || e.status === 429 || e.status >= 500) {
        planRetry(e.retryAfter);
      }
    } finally {
      clearTimeout(timeout);
      controllers.delete(controller);
    }
  };
  const enqueue = (names) => {
    const promises = [];
    for (const name of names) {
      if (!pending.has(name)) {
        let resolve;
        const promise = new Promise((done) => {
          resolve = done;
        });
        pending.set(name, { promise, resolve });
        queued.add(name);
      }
      promises.push(pending.get(name).promise);
    }
    if (queued.size && !flushQueued) {
      flushQueued = true;
      queueMicrotask(() => {
        flushQueued = false;
        const batch = [...queued];
        queued.clear();
        serial = serial.then(async () => {
          let group = [];
          let bytes = 13;
          for (const name of batch) {
            const size = Buffer.byteLength(JSON.stringify(name)) + 1;
            if (group.length >= 1000 || bytes + size > 250 * 1024) {
              await request(group);
              group = [];
              bytes = 13;
            }
            group.push(name);
            bytes += size;
          }
          if (group.length) {
            await request(group);
          }
          for (const name of batch) {
            pending.get(name)?.resolve();
            pending.delete(name);
          }
        });
      });
    }
    return Promise.all(promises);
  };
  const refreshInternal = async (reset) => {
    if (stopped || !active) {
      throw new Error('The client has not been started.');
    }
    if (refreshPromise) {
      return refreshPromise;
    }
    if (reset) {
      retryCount = 0;
      clearTimer(retryTimer);
      retryTimer = null;
    }
    refreshPromise = enqueue([...wanted]).finally(() => {
      refreshPromise = null;
    });
    await refreshPromise;
    return [...wanted].map(result);
  };
  const schedule = () => {
    if (!active) {
      return;
    }
    const next = nextRefreshTime({ now: now(), timezone, random, afterWindow: lastWindow });
    nextScheduledAt = new Date(next.time).toISOString();
    scheduleTimer = setTimer(async () => {
      lastWindow = next.windowId;
      try {
        await refreshInternal(true);
      } finally {
        if (active) {
          schedule();
        }
      }
    }, next.time - now());
    scheduleTimer.unref?.();
  };
  return {
    async start() {
      if (stopped) {
        throw new Error('A stopped client cannot be restarted.');
      }
      if (active) {
        return;
      }
      active = true;
      schedule();
      await refreshInternal(true);
    },
    async get(names) {
      checkNames(names);
      if (!active || stopped) {
        throw new Error('The client has not been started.');
      }
      names.forEach((n) => wanted.add(n));
      await enqueue([...new Set(names)].filter((n) => !cache.has(n)));
      return names.map(result);
    },
    refresh() {
      return refreshInternal(true);
    },
    get nextRefreshAt() {
      return nextScheduledAt;
    },
    stop() {
      active = false;
      stopped = true;
      clearTimer(scheduleTimer);
      clearTimer(retryTimer);
      nextScheduledAt = null;
      controllers.forEach((c) => c.abort());
    },
  };
}

async function readBounded(response, limit) {
  if (!response.body) {
    throw new Error();
  }
  const reader = response.body.getReader();
  const chunks = [];
  let size = 0;
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) {
        break;
      }
      size += value.byteLength;
      if (size > limit) {
        throw new Error();
      }
      chunks.push(value);
    }
    return Buffer.concat(chunks).toString('utf8');
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}

function validRecord(r, name) {
  if (
    !r ||
    r.requestedName !== name ||
    typeof r.catalogVersion !== 'string' ||
    !/^[a-f0-9]{64}$/.test(r.catalogVersion)
  ) {
    return false;
  }
  if (r.status === 'not_found') {
    return r.matchedName === null && r.canonicalName === null && r.model === null;
  }
  return (
    r.status === 'found' &&
    typeof r.matchedName === 'string' &&
    typeof r.canonicalName === 'string' &&
    validateModel(r.model)
  );
}
