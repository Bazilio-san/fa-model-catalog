import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { parseDocument } from 'yaml';
export function defaultCatalogFile(root = fileURLToPath(new URL('../', import.meta.url))) {
  const catalog = resolve(root, 'catalog.yaml');
  return existsSync(catalog) ? catalog : resolve(root, 'catalog.example.yaml');
}

export function validateAccess(access, { allowEmpty = false } = {}) {
  if (!access || typeof access !== 'object' || Array.isArray(access) ||
      Object.keys(access).some((key) => key !== 'token') ||
      !(typeof access.token === 'string' && /^[A-Za-z0-9_-]{43,}$/.test(access.token)) &&
      !(allowEmpty && access.token === '')) {
    throw new Error('Invalid access.token.');
  }
}


export async function readSettings(file, { allowEmptyAccess = false } = {}) {
  try {
    const doc = parseDocument(await readFile(file, 'utf8'), { uniqueKeys: true });
    if (doc.errors.length || doc.warnings.length) {
      throw new Error();
    }
    const data = doc.toJS({ maxAliasCount: 0 });
    const config = data.server;
    if (
      !data ||
      Object.keys(data).some((key) => !['server', 'access'].includes(key)) ||
      !config ||
      Object.keys(config).some((key) => !['catalogFile', 'host', 'port', 'reloadIntervalMs'].includes(key)) ||
      (config.catalogFile !== undefined && (typeof config.catalogFile !== 'string' || !config.catalogFile)) ||
      typeof config.host !== 'string' ||
      !config.host ||
      !Number.isInteger(config.port) ||
      config.port < 1 ||
      config.port > 65535 ||
      (config.reloadIntervalMs !== undefined &&
        (!Number.isSafeInteger(config.reloadIntervalMs) ||
          config.reloadIntervalMs < 10 ||
          config.reloadIntervalMs > 2147483647))
    ) {
      throw new Error();
    }
    validateAccess(data.access, { allowEmpty: allowEmptyAccess });
    return { ...data, server: { ...config, catalogFile: config.catalogFile === undefined ? defaultCatalogFile() : resolve(dirname(file), config.catalogFile) } };
  } catch {
    throw new Error('Invalid application settings: check server and access in config/local.yaml.');
  }
}
