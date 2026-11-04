#!/usr/bin/env node

import { execSync, spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

process.chdir(fileURLToPath(new URL('..', import.meta.url)));

const EXPECTED_BRANCH = 'master';
const args = process.argv.slice(2);
const noBump = args.includes('--no-bump') || args.includes('-n');
const addAll = args.includes('--add-all') || args.includes('-a');

function run(command) {
  const result = spawnSync(command, { shell: true, stdio: 'inherit' });
  if (result.error) {
    throw result.error;
  }
  if (result.status !== 0) {
    throw new Error(`Command failed: ${command}`);
  }
}

function readPackage() {
  const pkg = JSON.parse(readFileSync('package.json', 'utf8'));
  if (pkg.name !== 'fa-model-catalog' || !/^\d+\.\d+\.\d+$/.test(pkg.version)) {
    throw new Error('Expected fa-model-catalog with a three-part numeric version.');
  }
  return pkg;
}

function main() {
  if (args.some((arg) => !['--no-bump', '-n', '--add-all', '-a', '--help', '-h'].includes(arg))) {
    throw new Error('Unknown argument. Use --help for usage.');
  }
  if (args.includes('--help') || args.includes('-h')) {
    console.log('Usage: node scripts/publish.js [--no-bump|-n] [--add-all|-a]');
    console.log('Publish fa-model-catalog from master after quality and package checks.');
    console.log('Default: increment patch version, stage tracked changes, commit, push, and publish.');
    console.log('  --no-bump, -n   Keep the current version.');
    console.log('  --add-all, -a   Also stage untracked files allowed by Git ignore rules.');
    return;
  }

  const pkg = readPackage();
  const branch = execSync('git symbolic-ref --short HEAD', { encoding: 'utf8' }).trim();
  if (branch !== EXPECTED_BRANCH) {
    throw new Error(`Expected branch ${EXPECTED_BRANCH}; current branch is ${branch}.`);
  }

  run('npm run quality');
  if (!noBump) {
    run('npm version patch --no-git-tag-version --ignore-scripts');
  }
  const { version } = readPackage();
  console.log(`Publishing ${pkg.name}@${version}`);
  run('npm pack --dry-run --ignore-scripts');
  run(addAll ? 'git add --all' : 'git add -u');
  const staged = execSync('git diff --cached --name-only', { encoding: 'utf8' }).trim();
  if (staged) {
    run(`git commit -m "${version}"`);
  } else {
    console.log('Nothing staged; skipping commit.');
  }
  run(`git push origin refs/heads/${EXPECTED_BRANCH}:${EXPECTED_BRANCH}`);
  run('npm publish --access public --ignore-scripts');
}

try {
  main();
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
