import { readFile } from 'node:fs/promises';
import { readUserConfig, resolveConfig } from '../../config/user-config.js';
import { loadGovernanceContext } from '../../proxy/middleware/governance-loader.js';
import { validateResponse } from '../../validators/engine/validate-response.js';
import {
  formatWarnings,
  formatBlockedResponse,
} from '../../validators/reporting/warning-formatter.js';

export async function runValidate(filePath: string | undefined): Promise<void> {
  let content: string;

  if (filePath) {
    content = await readFile(filePath, 'utf-8');
  } else {
    content = await readStdin();
  }

  const config = resolveConfig(await readUserConfig());
  const context = await loadGovernanceContext(config.projectRoot);
  const result = validateResponse(content, context.rules);

  if (result.severity === 'pass') {
    console.log('✓ No governance issues found.');
    return;
  }

  if (result.blocked) {
    console.error(formatBlockedResponse(result));
    process.exit(1);
  }

  console.warn(formatWarnings(result));
}

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as string));
  }
  return Buffer.concat(chunks).toString('utf-8');
}
