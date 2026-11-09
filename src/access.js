import { timingSafeEqual } from 'node:crypto';
import { AccessError, bearerToken, parseAccessFile } from 'fa-web-access';
import { stringify } from 'yaml';
import { readSettings } from './settings.js';

export function createConfigAccessControl({ access, configFile, reloadIntervalMs, onEvent }) {
  let entries = [];
  let loaded = false;
  let stopped = false;
  let timer;
  let pending;
  function emit(event) {
    try {
      void Promise.resolve(onEvent({ event })).catch(() => {});
    } catch {
      /* Keep access independent of logging. */
    }
  }
  async function apply() {
    const settings = configFile ? (await readSettings(configFile, { allowEmptyAccess: loaded })).access : access;
    const clients = parseAccessFile(stringify(settings), { allowEmpty: loaded });
    if (stopped) {
      return false;
    }
    entries = clients.flatMap((client) => client.keys.map((key) => Buffer.from(key.token, 'utf8')));
    loaded = true;
    return true;
  }
  function reload() {
    if (stopped) {
      return Promise.reject(new Error('Access control has been stopped.'));
    }
    if (!pending) {
      pending = apply()
        .catch(() => {
          emit('access_reload_failed');
          throw new Error('Could not load access settings from config/local.yaml.');
        })
        .finally(() => {
          pending = undefined;
          if (!stopped && loaded && configFile) {
            clearTimeout(timer);
            timer = setTimeout(() => {
              void reload().catch(() => {});
            }, reloadIntervalMs);
            timer.unref();
          }
        });
    }
    return pending;
  }
  return {
    load: reload,
    reload,
    authenticate(request) {
      const token = bearerToken(request);
      if (stopped || !loaded || !token) {
        throw new AccessError();
      }
      const bytes = Buffer.from(token, 'utf8');
      let matched = false;
      for (const entry of entries) {
        matched = timingSafeEqual(entry, bytes) || matched;
      }
      if (!matched) {
        throw new AccessError();
      }
    },
    stop() {
      stopped = true;
      clearTimeout(timer);
      entries = [];
    },
  };
}
