import { mkdir, mkdtemp, writeFile, rm } from 'node:fs/promises';
import { resolve } from 'node:path';
import { stringify } from 'yaml';
export function model(overrides = {}) {
  return {
    inp: 2,
    inpC: 0.2,
    inpW: 2.5,
    out: 10,
    inpF: 1,
    inpCF: 0.1,
    inpWF: 1.25,
    outF: 5,
    inpB: 1,
    outB: 5,
    inpFast: 4,
    outFast: 20,
    billing: { kind: 'tokens', unit: 'tokens', per: 1000000 },
    modes: ['standard', 'flex', 'batch', 'fast'],
    capabilities: { promptCacheKey: true, explicitPromptCaching: true, reasoningEfforts: ['low', 'high'] },
    evidence: { status: 'confirmed', sources: [] },
    ...overrides,
  };
}
export function catalog(models = { demo: model(), 'openai/demo': 'demo', 'example@developer': 'demo' }) {
  return stringify({ schemaVersion: 1, currency: 'USD', models });
}
export async function files(t) {
  const parent = resolve('../TEST-OUT-DATA/model-catalog/tests');
  await mkdir(parent, { recursive: true });
  const root = await mkdtemp(`${parent}/run-`);
  const catalogFile = `${root}/catalog.yaml`;
  const configFile = `${root}/config/local.yaml`;
  await mkdir(`${root}/config`);
  const token = 'a'.repeat(43);
  await writeFile(catalogFile, catalog());
  const access = { clients: [{ id: 'test', keys: [{ id: 'one', token }] }] };
  await writeFile(configFile, stringify({ server: { catalogFile, host: '127.0.0.1', port: 3000 }, access }));
  t.after(() => rm(root, { recursive: true, force: true }));
  return { root, catalogFile, configFile, access, token };
}
