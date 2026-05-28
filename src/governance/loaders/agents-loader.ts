import { join } from 'node:path';
import { safeReadFile } from '../../utils/filesystem.js';
import { splitFrontMatter } from '../../utils/markdown.js';
import type { GovernanceFile } from '../../types/governance.js';

export async function loadAgentsContext(projectRoot: string): Promise<GovernanceFile | null> {
  const content = await safeReadFile(join(projectRoot, 'AGENTS.md'));
  if (!content) return null;

  const { body } = splitFrontMatter(content);

  return {
    source: 'agents',
    projectRoot,
    content: body,
  };
}
