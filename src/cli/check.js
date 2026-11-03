#!/usr/bin/env node
import { readFile } from 'node:fs/promises';
import { parseArgs } from 'node:util';
import { parseCatalog } from '../schemas/catalog.js';
try {
  const { values } = parseArgs({ options: { file: { type: 'string', default: 'catalog.example.yaml' } } });
  const data = parseCatalog(await readFile(values.file, 'utf8'));
  console.log(`Catalog validated: ${Object.keys(data.models).length} names; version ${data.catalogVersion}.`);
} catch (e) {
  console.error(e.message);
  process.exitCode = 1;
}
