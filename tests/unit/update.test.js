import assert from 'node:assert/strict';
import test from 'node:test';
import { classifyChanges, mergeChanges, parseArgs, validateOptions } from '../../update.js';

test('Update arguments preserve forced and inspection modes and reject unsafe values', () => {
  const options = parseArgs([
    '-f',
    '--server-config',
    '/etc/catalog/server.yaml',
    '--health-url',
    'http://127.0.0.1:3000/health',
  ]);
  assert.equal(options.force, true);
  assert.equal(parseArgs(['--check']).check, true);
  assert.deepEqual(parseArgs(['--service', 'catalog']).services, ['catalog']);
  validateOptions(options);
  assert.throws(() => parseArgs(['--service']), /value is required/);
  assert.throws(() => parseArgs(['--unknown']), /Unknown argument/);
  assert.throws(() => validateOptions({ ...options, services: ['bad name'] }), /service name/);
  assert.throws(() => validateOptions({ ...options, branch: '../outside' }), /branch name/);
  assert.throws(() => validateOptions({ ...options, revision: 'HEAD' }), /commit identifier/);
  assert.throws(() => validateOptions({ ...options, healthUrl: 'http://example.com/health' }), /loopback/);
});

test('Only package manifests require dependency installation; declarations and docs are not runtime changes', () => {
  assert.deepEqual(classifyChanges(['docs/client.md', 'src/types/client.d.ts']), {
    dependencyChanges: false,
    runtimeChanges: false,
    files: ['docs/client.md', 'src/types/client.d.ts'],
  });
  assert.equal(classifyChanges(['package-lock.json']).dependencyChanges, true);
  assert.equal(classifyChanges(['src/catalog-schemas.js']).runtimeChanges, true);
  assert.deepEqual(classifyChanges(['src\\client.js', 'src/client.js']).files, ['src/client.js']);
});

test('A retry retains dependency work from a failed previous update', () => {
  const merged = mergeChanges(classifyChanges(['docs/client.md']), {
    dependencyChanges: true,
    runtimeChanges: true,
    files: ['package-lock.json'],
  });
  assert.equal(merged.dependencyChanges, true);
  assert.equal(merged.runtimeChanges, true);
  assert.deepEqual(merged.files, ['docs/client.md', 'package-lock.json']);
});
