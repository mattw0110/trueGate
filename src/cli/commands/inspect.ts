import { readUserConfig, resolveConfig } from '../../config/user-config.js';
import { loadGovernanceContext } from '../../proxy/middleware/governance-loader.js';
import {
  formatContextSummary,
  formatOverrideReport,
} from '../../validators/reporting/override-report.js';

export async function runInspect(options: { project?: string }): Promise<void> {
  const config = resolveConfig(await readUserConfig());
  if (options.project) config.projectRoot = options.project;

  console.log(`Inspecting governance for: ${config.projectRoot}\n`);

  const context = await loadGovernanceContext(config.projectRoot);

  console.log(formatContextSummary(context));

  const overrideReport = formatOverrideReport(context);
  if (overrideReport) {
    console.log('\n' + overrideReport);
  }

  console.log('\n## System Message Preview (first 500 chars)\n');
  console.log(context.systemMessage.slice(0, 500));
  if (context.systemMessage.length > 500) {
    console.log(`\n... (${context.systemMessage.length - 500} more chars)`);
  }
}
