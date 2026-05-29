import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * trueGate is self-contained: every file it reads or writes lives inside the
 * repo root. There is no `~/.truegate/`, no `~/.cli-proxy-api/`, no global
 * install location. `git clone && npm install && npm start` is the whole
 * setup.
 *
 * Layout (all paths relative to the repo root):
 *
 *   data/        — shipped defaults (governance.md, rules.yaml). Tracked.
 *   .state/      — operator-mutable state (config.json, knowledge base,
 *                  cliproxy credentials). Gitignored.
 *   vendor/      — bundled third-party binaries (cli-proxy-api). Gitignored.
 *
 * The repo root is discovered by walking up from this file's location until
 * a `package.json` containing `"name": "truegate"` is found. This works for
 * both source (tsx) and built (dist) execution.
 */

function findRepoRoot(): string {
  let dir: string;
  try {
    dir = dirname(fileURLToPath(import.meta.url));
  } catch {
    // CJS fallback when bundlers rewrite import.meta.url
    dir = process.cwd();
  }
  for (let i = 0; i < 6; i++) {
    try {
      const raw = readFileSync(join(dir, 'package.json'), 'utf-8');
      const pkg = JSON.parse(raw) as { name?: string };
      if (pkg.name === 'truegate') return dir;
    } catch {
      /* file not here, walk up */
    }
    const parent = resolve(dir, '..');
    if (parent === dir) break;
    dir = parent;
  }
  return process.cwd();
}

const REPO_ROOT = findRepoRoot();

/** Absolute path to the trueGate repo root. */
export function repoRoot(): string {
  return REPO_ROOT;
}

/**
 * Shipped defaults: `<repo>/data/`. Read-only, tracked in git.
 * Override with TRUEGATE_DATA_DIR (useful for tests + packaged installs).
 */
export function dataDir(): string {
  return process.env['TRUEGATE_DATA_DIR'] ?? join(REPO_ROOT, 'data');
}

/**
 * Operator-mutable state: `<repo>/.state/`. Gitignored.
 * Override with TRUEGATE_STATE_DIR.
 */
export function stateDir(): string {
  return process.env['TRUEGATE_STATE_DIR'] ?? join(REPO_ROOT, '.state');
}

/**
 * Bundled binaries: `<repo>/vendor/`. Gitignored.
 * Override with TRUEGATE_VENDOR_DIR.
 */
export function vendorDir(): string {
  return process.env['TRUEGATE_VENDOR_DIR'] ?? join(REPO_ROOT, 'vendor');
}
