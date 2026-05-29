import { loadGovernanceContext } from '../../proxy/middleware/governance-loader.js';
import {
  formatContextSummary,
  formatOverrideReport,
} from '../../validators/reporting/override-report.js';

export async function runInspect(_options: Record<string, unknown> = {}): Promise<void> {
  console.log(`Inspecting trueGate governance (bundled defaults + .state/ overrides)\n`);

  const context = await loadGovernanceContext();

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
