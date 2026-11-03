#!/usr/bin/env node

/**
 * Links Codex and Claude Code skills on any operating system.
 *
 * Layout:
 *
 *   .agents/skills/          canonical skill storage: real files (read directly by Codex)
 *   .claude/skills -> ../.agents/skills   (link used by Claude Code to discover skills)
 *
 * The project root is resolved from this script's location (scripts/maintenance/../..), independently of
 * the working directory. Use --repo <path> to set the root explicitly.
 *
 * Only compatible entities are linked. The following are not linked:
 *   - .claude/agents    - Codex agents reside in .codex/agents/*.toml;
 *   - .claude/commands  - commands are migrated to skills;
 *   - .claude/settings  - Codex has its own .codex/config.toml and hooks.json;
 *   - .mcp.json         - Codex MCP servers are defined in .codex/config.toml.
 *
 * Usage: node scripts/maintenance/claude-2-agents-symlink.js [setup|remove|status] [--dry-run] [--force]
 *                [--repo <path>]
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const DEFAULT_REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

const LINK_MAPPINGS = [
  {
    name: 'skills',
    source: '.agents/skills',
    link: '.claude/skills',
  },
];

function parseArgs(argv) {
  const result = {
    mode: 'setup',
    repo: DEFAULT_REPO_ROOT,
    dryRun: false,
    force: false,
  };

  const positional = [];

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];

    if (arg === '--dry-run') {
      result.dryRun = true;
    } else if (arg === '--force') {
      result.force = true;
    } else if (arg === '--remove') {
      result.mode = 'remove';
    } else if (arg === '--status') {
      result.mode = 'status';
    } else if (arg === '--repo') {
      const value = argv[i + 1];
      if (!value) {
        throw new Error('A path is required after --repo.');
      }
      result.repo = path.resolve(value);
      i += 1;
    } else if (arg.startsWith('--repo=')) {
      result.repo = path.resolve(arg.slice('--repo='.length));
    } else if (arg.startsWith('-')) {
      throw new Error(`Unknown option: ${arg}`);
    } else {
      positional.push(arg);
    }
  }

  if (positional[0]) {
    const mode = positional[0];
    if (!['setup', 'remove', 'status'].includes(mode)) {
      throw new Error(`Unknown mode: ${mode}. Expected setup, remove, or status.`);
    }
    result.mode = mode;
  }

  return result;
}

function log(message) {
  process.stdout.write(`${message}${os.EOL}`);
}

function warn(message) {
  process.stderr.write(`WARNING: ${message}${os.EOL}`);
}

function pathInfo(targetPath) {
  try {
    const stat = fs.lstatSync(targetPath);
    return {
      exists: true,
      isSymbolicLink: stat.isSymbolicLink(),
    };
  } catch (error) {
    if (error && error.code === 'ENOENT') {
      return { exists: false, isSymbolicLink: false };
    }
    throw error;
  }
}

function realpathSafe(targetPath) {
  try {
    return fs.realpathSync.native(targetPath);
  } catch {
    return null;
  }
}

function normalizeForCompare(targetPath) {
  const resolved = path.resolve(targetPath);
  return process.platform === 'win32' ? resolved.toLowerCase() : resolved;
}

function sameResolvedPath(a, b) {
  const realA = realpathSafe(a) || path.resolve(a);
  const realB = realpathSafe(b) || path.resolve(b);

  return normalizeForCompare(realA) === normalizeForCompare(realB);
}

function readLinkTargetAbsolute(linkPath) {
  const raw = fs.readlinkSync(linkPath);
  if (path.isAbsolute(raw)) {
    return raw;
  }
  return path.resolve(path.dirname(linkPath), raw);
}

function currentTarget(linkPath) {
  try {
    return readLinkTargetAbsolute(linkPath);
  } catch {
    return 'unknown';
  }
}

function ensureDir(dirPath, dryRun) {
  if (pathInfo(dirPath).exists) {
    return;
  }

  if (dryRun) {
    log(`[dry run] create directory ${dirPath}`);
    return;
  }

  fs.mkdirSync(dirPath, { recursive: true });
}

// Windows uses a directory junction, which does not require administrator privileges.
function createDirectoryLink(sourcePath, linkPath, dryRun) {
  const parentDir = path.dirname(linkPath);
  ensureDir(parentDir, dryRun);

  const linkType = process.platform === 'win32' ? 'junction' : 'dir';
  const targetForLink =
    process.platform === 'win32' ? path.resolve(sourcePath) : path.relative(parentDir, sourcePath) || '.';

  if (dryRun) {
    log(`[dry run] link ${linkPath} -> ${targetForLink}`);
    return;
  }

  fs.symlinkSync(targetForLink, linkPath, linkType);
}

function setupMapping(repoRoot, mapping, options) {
  const sourcePath = path.resolve(repoRoot, mapping.source);
  const linkPath = path.resolve(repoRoot, mapping.link);

  ensureDir(sourcePath, options.dryRun);

  const link = pathInfo(linkPath);

  if (!link.exists) {
    createDirectoryLink(sourcePath, linkPath, options.dryRun);
    log(`Done: created link ${mapping.link} -> ${mapping.source}`);
    return;
  }

  if (link.isSymbolicLink) {
    if (sameResolvedPath(linkPath, sourcePath)) {
      log(`Done: ${mapping.link} already points to ${mapping.source}`);
      return;
    }

    if (!options.force) {
      warn(
        `${mapping.link} is already a link but does not point to ${mapping.source}. Use --force to replace it. Current target: ${currentTarget(linkPath)}`,
      );
      return;
    }

    if (options.dryRun) {
      log(`[dry run] remove previous link ${linkPath}`);
    } else {
      fs.rmSync(linkPath, { force: true });
    }

    createDirectoryLink(sourcePath, linkPath, options.dryRun);
    log(`Done: replaced link ${mapping.link}; it now points to ${mapping.source}`);
    return;
  }

  warn(
    `${mapping.link} already exists and is not a link. Real files and directories are not overwritten; move them manually first.`,
  );
}

function removeMapping(repoRoot, mapping, options) {
  const sourcePath = path.resolve(repoRoot, mapping.source);
  const linkPath = path.resolve(repoRoot, mapping.link);

  const link = pathInfo(linkPath);

  if (!link.exists) {
    log(`Done: ${mapping.link} does not exist`);
    return;
  }

  if (!link.isSymbolicLink) {
    warn(`${mapping.link} exists but is not a link. Skipping.`);
    return;
  }

  if (!sameResolvedPath(linkPath, sourcePath) && !options.force) {
    warn(
      `${mapping.link} is a link but does not point to ${mapping.source}. Use --force to remove it. Current target: ${currentTarget(linkPath)}`,
    );
    return;
  }

  if (options.dryRun) {
    log(`[dry run] remove link ${linkPath}`);
    return;
  }

  fs.rmSync(linkPath, { force: true });
  log(`Done: removed link ${mapping.link}`);
}

function statusMapping(repoRoot, mapping) {
  const sourcePath = path.resolve(repoRoot, mapping.source);
  const linkPath = path.resolve(repoRoot, mapping.link);

  const source = pathInfo(sourcePath);
  const link = pathInfo(linkPath);

  log(`\n[${mapping.name}]`);
  log(`source: ${mapping.source} ${source.exists ? 'exists' : 'missing'}`);
  log(`link:   ${mapping.link} ${link.exists ? 'exists' : 'missing'}`);

  if (link.exists && link.isSymbolicLink) {
    const ok = source.exists && sameResolvedPath(linkPath, sourcePath);
    log(`target: ${currentTarget(linkPath)}`);
    log(`status: ${ok ? 'correct link' : 'link points to the wrong target'}`);
    return;
  }

  if (link.exists && !link.isSymbolicLink) {
    log('status: a real directory or file occupies the link path');
    return;
  }

  log('status: link has not been created');
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  const repoRoot = path.resolve(options.repo);

  if (!pathInfo(repoRoot).exists) {
    throw new Error(`Project directory does not exist: ${repoRoot}`);
  }

  log(`project: ${repoRoot}`);
  log(`mode: ${options.mode}${options.dryRun ? ', dry run' : ''}${options.force ? ', force replacement' : ''}`);

  for (const mapping of LINK_MAPPINGS) {
    if (options.mode === 'setup') {
      setupMapping(repoRoot, mapping, options);
    } else if (options.mode === 'remove') {
      removeMapping(repoRoot, mapping, options);
    } else if (options.mode === 'status') {
      statusMapping(repoRoot, mapping);
    }
  }

  log('');
  log('Only skills are linked: they are the only entity shared by Codex and Claude Code.');
  log('Do not directly link .claude/agents, .claude/commands, settings, hooks, or MCP server definitions.');
}

try {
  main();
} catch (error) {
  process.stderr.write(`ERROR: ${error.message}${os.EOL}`);
  process.exit(1);
}
