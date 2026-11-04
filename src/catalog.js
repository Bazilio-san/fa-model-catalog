import { readFile } from 'node:fs/promises';
import { parseCatalog } from './catalog-schemas.js';

export function resolveModels(snapshot, names) {
  return names.map((requestedName) => {
    let matchedName = requestedName;
    if (!Object.hasOwn(snapshot.resolved, matchedName) && matchedName.includes('@')) {
      matchedName = matchedName.slice(matchedName.indexOf('@') + 1);
    }
    const found = Object.hasOwn(snapshot.resolved, matchedName) ? snapshot.resolved[matchedName] : null;
    return {
      requestedName,
      matchedName: found ? matchedName : null,
      canonicalName: found?.canonicalName ?? null,
      status: found ? 'found' : 'not_found',
      model: found?.model ?? null,
      catalogVersion: snapshot.catalogVersion,
    };
  });
}

export function createCatalogStore({ file, reloadIntervalMs = 5000, onEvent = () => {} }) {
  let snapshot;
  let timer;
  let stopped = false;
  let pending;
  let error = null;
  const emit = (event) => {
    try {
      onEvent(event);
    } catch {
      /* Observer cannot change state. */
    }
  };
  const reload = () => {
    if (stopped) {
      return Promise.reject(new Error('The catalog has been stopped.'));
    }
    if (pending) {
      return pending;
    }
    pending = (async () => {
      try {
        const text = await readFile(file, 'utf8');
        if (Buffer.byteLength(text) > 8 * 1024 * 1024) {
          throw new Error('The catalog exceeds 8 MiB.');
        }
        const next = parseCatalog(text);
        if (stopped) {
          return false;
        }
        const changed = snapshot?.catalogVersion !== next.catalogVersion;
        if (changed || error) {
          emit({
            event: 'catalog_applied',
            catalogVersion: next.catalogVersion,
            count: Object.keys(next.models).length,
          });
        }
        snapshot = next;
        error = null;
        return changed;
      } catch (e) {
        if (!stopped) {
          error = 'Could not read or validate the catalog.';
          emit({ event: 'catalog_reload_failed', reason: error });
        }
        throw e;
      } finally {
        pending = null;
      }
    })();
    return pending;
  };
  const schedule = () => {
    if (stopped) {
      return;
    }
    timer = setTimeout(async () => {
      try {
        await reload();
      } catch {
        /* Keep last good snapshot. */
      }
      schedule();
    }, reloadIntervalMs);
    timer.unref();
  };
  return {
    async load() {
      await reload();
      if (!timer) {
        schedule();
      }
    },
    reload,
    get snapshot() {
      return snapshot;
    },
    get error() {
      return error;
    },
    stop() {
      stopped = true;
      clearTimeout(timer);
    },
  };
}
