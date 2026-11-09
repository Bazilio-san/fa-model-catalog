import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { parseDocument, stringify } from 'yaml';
import { parseAccessFile } from 'fa-web-access';

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
      typeof config.catalogFile !== 'string' ||
      !config.catalogFile ||
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
    parseAccessFile(stringify(data.access), { allowEmpty: allowEmptyAccess });
    return { ...data, server: { ...config, catalogFile: resolve(dirname(file), config.catalogFile) } };
  } catch {
    throw new Error('Invalid application settings: check server and access in config/local.yaml.');
  }
}
