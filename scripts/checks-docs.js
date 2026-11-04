import { readFile, access, readdir } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';

function parseRules(text, base) {
  return text.split(/\r?\n/).flatMap((line) => {
    if (!line || line.startsWith('#')) {
      return [];
    }
    const negate = line.startsWith('!');
    let pattern = negate ? line.slice(1) : line;
    const directoryOnly = pattern.endsWith('/');
    if (directoryOnly) {
      pattern = pattern.slice(0, -1);
    }
    const anchored = pattern.includes('/');
    pattern = pattern.replace(/^\//, '');
    const expression = pattern
      .split(/(\*\*\/|\*\*|\*|\?)/)
      .map((part) => {
        if (part === '**/') {
          return '(?:.*/)?';
        }
        if (part === '**') {
          return '.*';
        }
        if (part === '*') {
          return '[^/]*';
        }
        if (part === '?') {
          return '[^/]';
        }
        return part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      })
      .join('');
    return [{ base, negate, directoryOnly, match: new RegExp(`${anchored ? '^' : '(?:^|/)'}${expression}$`) }];
  });
}

async function readRules(directory, name, base) {
  try {
    return parseRules(await readFile(resolve(directory, name), 'utf8'), base);
  } catch (error) {
    if (error.code === 'ENOENT') {
      return [];
    }
    throw error;
  }
}

async function* documents(directory, base = '', gitRules = [], rgRules = []) {
  const git = [...gitRules, ...(await readRules(directory, '.gitignore', base))];
  const rg = [...rgRules, ...(await readRules(directory, '.rgignore', base))];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (entry.name === '.git' || entry.isSymbolicLink()) {
      continue;
    }
    const name = base + entry.name;
    let ignored = false;
    // Ripgrep rules take precedence over Git rules, including in parent directories.
    for (const rule of [...git, ...rg]) {
      if (rule.directoryOnly && !entry.isDirectory()) {
        continue;
      }
      if (name.startsWith(rule.base) && rule.match.test(name.slice(rule.base.length))) {
        ignored = !rule.negate;
      }
    }
    if (ignored) {
      continue;
    }
    const file = resolve(directory, entry.name);
    if (entry.isDirectory()) {
      yield* documents(file, `${name}/`, git, rg);
    } else if (entry.isFile() && entry.name.endsWith('.md')) {
      yield file;
    }
  }
}

// Honor .gitignore and .rgignore so documentation checks never read private or excluded directories.
let checked = 0;
for await (const file of documents(resolve('.'))) {
  const text = await readFile(file, 'utf8');
  for (const match of text.matchAll(/\]\(([^)]+)\)/g)) {
    const link = match[1];
    if (/^(https?:|#)/.test(link)) {
      continue;
    }
    await access(resolve(dirname(file), link.split('#')[0]));
  }
  checked++;
}
console.log(`Checked links in ${checked} documents.`);
