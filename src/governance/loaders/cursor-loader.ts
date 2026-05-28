import { join } from 'node:path';
import { readdir } from 'node:fs/promises';
import { safeReadFile } from '../../utils/filesystem.js';
import type { GovernanceFile } from '../../types/governance.js';

export async function loadCursorContext(projectRoot: string): Promise<GovernanceFile | null> {
  const rulesDir = join(projectRoot, '.cursor', 'rules');

  let files: string[];
  try {
    files = await readdir(rulesDir);
  } catch {
    return null;
  }

  const mdcFiles = files.filter((f) => f.endsWith('.mdc')).sort();

  if (mdcFiles.length === 0) return null;

  const parts: string[] = [];
  for (const file of mdcFiles) {
    const content = await safeReadFile(join(rulesDir, file));
    if (content) parts.push(content);
  }

  if (parts.length === 0) return null;

  return {
    source: 'cursor',
    projectRoot,
    content: parts.join('\n\n'),
  };
}
