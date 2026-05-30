import { loadGlobalContext } from '../loaders/global-loader.js';
import type { GovernanceFile } from '../../types/governance.js';

/**
 * Load governance for the proxy. trueGate is self-contained — the only
 * governance it injects is the operator bundle loaded from `<repo>/data/`
 * (shipped defaults) with `<repo>/.state/` overrides on top. It deliberately
 * does NOT read anything from a dev project's directory: the dev's project
 * tooling (Claude Code, Cursor, …) already surfaces its own CLAUDE.md /
 * AGENTS.md / .cursor/rules to the model, and trueGate should not
 * duplicate, override, or otherwise touch that surface.
 */
export async function mergeContext(): Promise<GovernanceFile[]> {
  const global = await loadGlobalContext();
  return global ? [global] : [];
}
