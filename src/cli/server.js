#!/usr/bin/env node
import { resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { readSettings } from '../settings.js';
import { createCatalogServer } from '../server.js';
try {
  const { values } = parseArgs({
    options: { config: { type: 'string', default: 'config/local.yaml' } },
  });
  const file = resolve(values.config);
  const { server: config, access } = await readSettings(file);
  const app = createCatalogServer({
    ...config,
    access,
    configFile: file,
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
  console.error('Could not start the service: check config/local.yaml and the catalog.');
  process.exitCode = 1;
}
