import { createServer } from 'node:http';
import { defaultCatalogFile } from './settings.js';
import { AccessError } from 'fa-web-access';
import { createConfigAccessControl } from './access.js';
import { createCatalogStore, resolveModels } from './catalog.js';

export function createCatalogServer({
  catalogFile = defaultCatalogFile(),
  access: accessSettings,
  configFile,
  reloadIntervalMs = 5000,
  onEvent = () => {},
}) {
  if (
    !catalogFile ||
    !accessSettings ||
    !Number.isSafeInteger(reloadIntervalMs) ||
    reloadIntervalMs < 10 ||
    reloadIntervalMs > 2147483647
  ) {
    throw new Error('Invalid server settings.');
  }
  const store = createCatalogStore({ file: catalogFile, reloadIntervalMs, onEvent });
  const access = createConfigAccessControl({ access: accessSettings, configFile, reloadIntervalMs, onEvent });
  const send = (res, status, value, headers = {}) => {
    res.writeHead(status, {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      ...headers,
    });
    res.end(JSON.stringify(value));
  };
  const server = createServer(async (req, res) => {
    if (req.method === 'GET' && req.url === '/health') {
      send(res, store.snapshot ? 200 : 503, { status: store.error ? 'degraded' : 'ok' });
      return;
    }
    try {
      access.authenticate(req);
    } catch (e) {
      send(
        res,
        e instanceof AccessError ? e.status : 503,
        { error: 'Access denied.' },
        e instanceof AccessError ? e.headers : {},
      );
      req.resume();
      return;
    }
    if (req.method !== 'POST' || req.url !== '/v1/models/resolve') {
      send(res, 404, { error: 'Not found.' });
      req.resume();
      return;
    }
    try {
      if (!/^application\/json(?:\s*;|$)/i.test(req.headers['content-type'] || '')) {
        send(res, 400, { error: 'JSON is required.' });
        req.resume();
        return;
      }
      const chunks = [];
      let size = 0;
      for await (const chunk of req) {
        size += chunk.length;
        if (size > 256 * 1024) {
          send(res, 413, { error: 'Request size limit exceeded.' });
          req.resume();
          return;
        }
        chunks.push(chunk);
      }
      const body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
      if (
        !body ||
        typeof body !== 'object' ||
        Array.isArray(body) ||
        Object.keys(body).some((k) => k !== 'models') ||
        !Array.isArray(body.models) ||
        body.models.length > 1000 ||
        body.models.some((n) => typeof n !== 'string' || !n.length || n.length > 512)
      ) {
        send(res, 400, { error: 'Expected an array of at most 1000 nonempty names, each up to 512 characters long.' });
        return;
      }
      send(res, 200, resolveModels(store.snapshot, body.models));
    } catch {
      if (!res.headersSent) {
        send(res, 400, { error: 'Could not read the request.' });
      }
    }
  });
  server.requestTimeout = 10000;
  server.headersTimeout = 10000;
  let closed = false;
  return {
    server,
    store,
    access,
    async listen({ port = 3000, host = '127.0.0.1' } = {}) {
      if (closed) {
        throw new Error('The server has been stopped.');
      }
      try {
        await access.load();
        await store.load();
        await new Promise((resolve, reject) => {
          const fail = (e) => {
            server.off('listening', ready);
            reject(e);
          };
          const ready = () => {
            server.off('error', fail);
            resolve();
          };
          server.once('error', fail);
          server.once('listening', ready);
          server.listen(port, host);
        });
        return server.address();
      } catch (e) {
        access.stop();
        store.stop();
        throw e;
      }
    },
    async close() {
      closed = true;
      access.stop();
      store.stop();
      if (server.listening) {
        await new Promise((resolve, reject) => {
          server.close((e) => (e ? reject(e) : resolve()));
          server.closeIdleConnections();
        });
      }
    },
  };
}
