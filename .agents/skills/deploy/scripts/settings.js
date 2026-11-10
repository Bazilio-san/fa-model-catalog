import { existsSync } from 'node:fs';
import fs from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { parseDocument } from 'yaml';

const configsDirectory = fileURLToPath(new URL('../configs/', import.meta.url));

export function selectServer(args, directory = configsDirectory) {
  const { values, positionals } = parseArgs({
    args,
    allowPositionals: true,
    options: { server: { type: 'string', multiple: true } },
  });
  const names = values.server || [];
  if (names.length !== 1 || !/^[a-z0-9][a-z0-9._-]*$/.test(names[0])) {
    throw new Error('Specify --server <name> exactly once. No server is selected by default.');
  }
  if (positionals.length !== 1) {
    throw new Error('Specify exactly one deployment command.');
  }
  const name = names[0];
  const configDirectory = resolve(directory, name);
  return { name, command: positionals[0], configDirectory, rulesFile: resolve(configDirectory, 'rules.md') };
}

export async function loadSettings(selection) {
  const documents = {};
  for (const filename of ['config.yaml', 'local.yaml', 'rules.md']) {
    let text;
    try {
      text = await fs.readFile(resolve(selection.configDirectory, filename), 'utf8');
    } catch {
      throw new Error(
        `Cannot read ${filename} for the selected server. Copy configs/_example and fill all three files.`,
      );
    }
    if (filename === 'rules.md') {
      if (!text.trim()) {
        throw new Error('The selected server rules.md must not be empty.');
      }
      continue;
    }
    const document = parseDocument(text, { uniqueKeys: true });
    if (document.errors.length) {
      throw new Error(`Invalid ${filename} for the selected server.`);
    }
    let data;
    try {
      data = document.toJS({ maxAliasCount: 0 });
    } catch {
      throw new Error(`Invalid ${filename} for the selected server.`);
    }
    const sections = filename === 'config.yaml' ? ['remote', 'deployment'] : ['access', 'server'];
    if (
      !data ||
      typeof data !== 'object' ||
      Array.isArray(data) ||
      sections.some((key) => !data[key] || typeof data[key] !== 'object' || Array.isArray(data[key])) ||
      Object.keys(data).some((key) => !sections.includes(key))
    ) {
      throw new Error(`${filename} must contain only the required sections: ${sections.join(', ')}.`);
    }
    documents[filename] = data;
  }
  return { ...documents['config.yaml'], ...documents['local.yaml'] };
}

export function selectCatalogSource(configDirectory, root) {
  return [resolve(configDirectory, 'catalog.yaml'), resolve(root, 'catalog.yaml'),
    resolve(root, 'catalog.example.yaml')].find((file) => existsSync(file));
}
