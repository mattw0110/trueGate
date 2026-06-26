import { printGovernanceLog, printGovernanceSummary } from '../../governance/events/logger.js';

export async function runLogs(options: {
  follow?: boolean;
  lines?: string;
  pretty?: boolean;
  color?: boolean;
  summary?: boolean;
}): Promise<void> {
  const parsedLines = options.lines ? parseInt(options.lines, 10) : NaN;
  if (options.summary) {
    const summaryOptions: { lines?: number } = {};
    if (Number.isFinite(parsedLines)) summaryOptions.lines = parsedLines;
    await printGovernanceSummary(summaryOptions);
    return;
  }

  const logOptions: { follow: boolean; lines?: number; pretty?: boolean } = {
    follow: options.follow ?? false,
    pretty: options.pretty ?? false,
  };
  const color = options.color ?? true;
  const typedOptions: { follow: boolean; lines?: number; pretty?: boolean; color?: boolean } = {
    ...logOptions,
    color,
  };
  if (Number.isFinite(parsedLines)) typedOptions.lines = parsedLines;
  await printGovernanceLog(typedOptions);
}
