import { readdir, readFile, access } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
let checked = 0;
async function walk(dir) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    if (['node_modules', '.git', '.idea'].includes(entry.name) || entry.name === 'servers.local.md') {
      continue;
    }
    const file = resolve(dir, entry.name);
    if (entry.isDirectory()) {
      await walk(file);
    } else if (entry.name.endsWith('.md')) {
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
  }
}
await walk(process.cwd());
console.log(`Checked links in ${checked} documents.`);
