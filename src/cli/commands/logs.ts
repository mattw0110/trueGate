import { printGovernanceLog, printGovernanceSummary } from '../../governance/events/logger.js';
import { loadGovernanceContext } from '../../proxy/middleware/governance-loader.js';
import type { GovernanceDecision } from '../../governance/events/logger.js';

const DECISIONS = new Set<GovernanceDecision>(['pass', 'warn', 'block', 'override_allowed']);

function parseDecision(value: string | undefined): GovernanceDecision | undefined {
  if (value === undefined) return undefined;
  if (DECISIONS.has(value as GovernanceDecision)) return value as GovernanceDecision;
  throw new Error(`Invalid decision "${value}". Expected one of: pass, warn, block, override_allowed`);
}

export async function runLogs(options: {
  follow?: boolean;
  lines?: string;
  pretty?: boolean;
  color?: boolean;
  summary?: boolean;
  hash?: string;
  currentGovernance?: boolean;
  decision?: string;
}): Promise<void> {
  const parsedLines = options.lines ? parseInt(options.lines, 10) : NaN;
  const decision = parseDecision(options.decision);
  if (options.summary) {
    const summaryOptions: { lines?: number; governanceHash?: string; decision?: GovernanceDecision } = {};
    if (Number.isFinite(parsedLines)) summaryOptions.lines = parsedLines;
    if (decision !== undefined) summaryOptions.decision = decision;
    if (options.currentGovernance) {
      const context = await loadGovernanceContext();
      const currentHash = context.trace?.governanceHash;
      if (currentHash !== undefined) summaryOptions.governanceHash = currentHash;
    } else if (options.hash) {
      summaryOptions.governanceHash = options.hash;
    }
    await printGovernanceSummary(summaryOptions);
    return;
  }

  const logOptions: { follow: boolean; lines?: number; pretty?: boolean } = {
    follow: options.follow ?? false,
    pretty: options.pretty ?? false,
  };
  const color = options.color ?? true;
  const typedOptions: { follow: boolean; lines?: number; pretty?: boolean; color?: boolean; decision?: GovernanceDecision } = {
    ...logOptions,
    color,
  };
  if (Number.isFinite(parsedLines)) typedOptions.lines = parsedLines;
  if (decision !== undefined) typedOptions.decision = decision;
  await printGovernanceLog(typedOptions);
}
