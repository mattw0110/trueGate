import { loadGlobalContext } from '../loaders/global-loader.js';
import { loadClaudeContext } from '../loaders/claude-loader.js';
import { loadAgentsContext } from '../loaders/agents-loader.js';
import { loadCursorContext } from '../loaders/cursor-loader.js';
import type { GovernanceFile } from '../../types/governance.js';

/**
 * Load governance sources, project-first.
 *
 * The PROJECT's own documentation (CLAUDE.md, AGENTS.md, .cursor/rules/) is
 * the source of truth for that project. The operator-wide knowledge base
 * at ~/.truegate/ is supplementary guidance that defers to the project.
 *
 * trueGate intentionally does NOT install per-project artifacts. Projects
 * own their conventions; trueGate provides the operator-wide layer.
 */
export async function mergeContext(projectRoot: string): Promise<GovernanceFile[]> {
  const results = await Promise.all([
    loadClaudeContext(projectRoot),
    loadAgentsContext(projectRoot),
    loadCursorContext(projectRoot),
    loadGlobalContext(),
  ]);

  return results.filter((r): r is GovernanceFile => r !== null);
}
