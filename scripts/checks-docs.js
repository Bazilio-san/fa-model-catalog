import { readFile, access } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

// Honor .gitignore and .rgignore so documentation checks never read private or excluded directories.
const { stdout } = await promisify(execFile)('rg', ['--files', '--hidden', '-g', '*.md', '-g', '!.git/**']);
let checked = 0;
for (const name of stdout.split(/\r?\n/).filter(Boolean)) {
  const file = resolve(name);
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
