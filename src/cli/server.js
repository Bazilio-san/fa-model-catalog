#!/usr/bin/env node
import { readFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { parseArgs } from 'node:util';
import { parseDocument } from 'yaml';
import { createCatalogServer } from '../server.js';
try {
  const { values } = parseArgs({
    options: { config: { type: 'string', default: '.agents/skills/deploy/config/config.local.yaml' } },
  });
  const file = resolve(values.config);
  const doc = parseDocument(await readFile(file, 'utf8'), { uniqueKeys: true });
  if (doc.errors.length) {
    throw new Error();
  }
  const document = doc.toJS({ maxAliasCount: 0 });
  const config = document.server ?? document;
  const allowed = ['catalogFile', 'accessFile', 'host', 'port', 'reloadIntervalMs'];
  if (
    !config ||
    Object.keys(config).some((k) => !allowed.includes(k)) ||
    !Number.isInteger(config.port) ||
    config.port < 1 ||
    config.port > 65535 ||
    typeof config.host !== 'string'
  ) {
    throw new Error();
  }
  const app = createCatalogServer({
    ...config,
    catalogFile: resolve(dirname(file), config.catalogFile),
    accessFile: resolve(dirname(file), config.accessFile),
    onEvent: (e) => console.log(JSON.stringify(e)),
  });
  await app.listen(config);
  console.log(`Service ready; port ${config.port}.`);
  let closing = false;
  for (const signal of ['SIGINT', 'SIGTERM']) {
    process.on(signal, async () => {
      if (!closing) {
        closing = true;
        await app.close();
      }
    });
  }
} catch {
  console.error('Could not start the service: check the settings, catalog, and access file.');
  process.exitCode = 1;
}
