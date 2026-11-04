import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

test('Documentation checks use Node.js and honor nested ignore rules', async () => {
  const root = await mkdtemp(join(tmpdir(), 'catalog-docs-'));
  const script = fileURLToPath(new URL('../../scripts/checks-docs.js', import.meta.url));
  async function put(name, text) {
    const path = join(root, name);
    await mkdir(join(path, '..'), { recursive: true });
    await writeFile(path, text);
  }
  try {
    await put('.gitignore', '*.local.md\nignored/\n*.hidden.md\n');
    await put('.rgignore', 'private/\n!visible.hidden.md\n**/_tmp/\n');
    await put('README.md', '[Guide](docs/guide.md)');
    await put('docs/guide.md', '[Home](../README.md)');
    await put('visible.hidden.md', '# Visible');
    await put('docs/.gitignore', '/excluded.md\n');
    for (const name of [
      'servers.local.md',
      'ignored/bad.md',
      'private/bad.md',
      '.git/bad.md',
      'docs/excluded.md',
      'docs/_tmp/bad.md',
    ]) {
      await put(name, '[Broken](missing-file)');
    }
    const run = () => promisify(execFile)(process.execPath, [script], { cwd: root, env: { ...process.env, PATH: '' } });
    assert.match((await run()).stdout, /Checked links in 3 documents/);
    await put('docs/broken.md', '[Broken](missing-file)');
    await assert.rejects(run(), /ENOENT/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
