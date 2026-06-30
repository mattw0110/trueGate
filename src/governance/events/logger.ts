import { createReadStream } from 'node:fs';
import { appendFile, mkdir, readFile, stat } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { stateDir } from '../../config/paths.js';
import type { GovernanceTrace } from '../../types/governance.js';
import type { ValidationIssue, ValidationResult } from '../../types/validation.js';

export type GovernanceDecision = 'pass' | 'warn' | 'block' | 'override_allowed';

export interface GovernanceLogEvent {
  event: 'governance_decision';
  decision: GovernanceDecision;
  route: string;
  provider?: string;
  model?: string;
  client?: string;
  statusCode?: number;
  issues?: ValidationIssue[];
  governance?: GovernanceTrace;
  overrideOffered?: boolean;
  overrideUsed?: boolean;
}

const MAX_MATCH_LENGTH = 200;
let writeQueue: Promise<void> = Promise.resolve();

type LoggedGovernanceTrace = Omit<GovernanceTrace, 'anchors' | 'ruleRefs' | 'guidanceItems'> & {
  anchors?: GovernanceTrace['anchors'];
  ruleRefs?: GovernanceTrace['ruleRefs'];
  guidanceItems?: GovernanceTrace['guidanceItems'];
};

export function governanceLogPath(): string {
  return join(stateDir(), 'logs', 'governance.ndjson');
}

function redactMatch(match: string | undefined): string | undefined {
  if (!match) return undefined;
  const trimmed = match.replace(/\s+/g, ' ').trim();
  return trimmed.length > MAX_MATCH_LENGTH ? `${trimmed.slice(0, MAX_MATCH_LENGTH)}...` : trimmed;
}

function redactedIssues(issues: ValidationIssue[] | undefined): ValidationIssue[] | undefined {
  if (!issues || issues.length === 0) return undefined;
  return issues.map((issue) => {
    const match = redactMatch(issue.match);
    if (match === undefined) {
      return {
        severity: issue.severity,
        rule: issue.rule,
        message: issue.message,
      };
    }
    return {
      severity: issue.severity,
      rule: issue.rule,
      message: issue.message,
      match,
    };
  });
}

function shouldExpandGovernance(event: GovernanceLogEvent): boolean {
  return event.decision !== 'pass' || (event.issues?.length ?? 0) > 0;
}

function compactGovernanceTrace(governance: GovernanceTrace | undefined): LoggedGovernanceTrace | undefined {
  if (!governance) return undefined;
  return {
    bundleSource: governance.bundleSource,
    ...(governance.governancePath !== undefined ? { governancePath: governance.governancePath } : {}),
    ...(governance.rulesPath !== undefined ? { rulesPath: governance.rulesPath } : {}),
    ...(governance.governanceHash !== undefined ? { governanceHash: governance.governanceHash } : {}),
    ...(governance.rulesHash !== undefined ? { rulesHash: governance.rulesHash } : {}),
  };
}

function matchingRuleRefs(
  issues: ValidationIssue[] | undefined,
  governance: GovernanceTrace | undefined,
): GovernanceTrace['ruleRefs'] {
  if (!issues || issues.length === 0) return undefined;
  const refs = issues
    .map((issue) => issueRuleRef(issue, governance))
    .filter((ref): ref is NonNullable<GovernanceTrace['ruleRefs']>[number] => ref !== undefined);
  return refs.length > 0 ? refs : undefined;
}

function tokensFor(value: string): string[] {
  return value
    .toLowerCase()
    .split(/[^a-z0-9_.-]+/)
    .filter((token) => token.length >= 4 && !['with', 'that', 'this', 'code', 'rule'].includes(token));
}

function fallbackId(prefix: string, value: string | undefined): string {
  const slug =
    value
      ?.toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 80) || 'unknown';
  return `${prefix}:${slug}`;
}

function relatedGuidance(
  issue: { rule?: string; message?: string; match?: string },
  governance: LoggedGovernanceTrace | undefined,
): Array<{ id: string; text: string }> {
  return relatedGuidanceItems(issue, governance).map((item) => {
    const file = governance?.governancePath ? basename(governance.governancePath) : 'governance.md';
    return {
      id: item.id ?? fallbackId('guidance', item.text),
      text: `${file}:${item.line}-${item.endLine} ${item.section}: ${item.text}`,
    };
  });
}

function relatedGuidanceItems(
  issue: { rule?: string; message?: string; match?: string },
  governance: LoggedGovernanceTrace | undefined,
): NonNullable<GovernanceTrace['guidanceItems']> {
  const items = governance?.guidanceItems ?? [];
  if (items.length === 0) return [];
  const issueTokens = new Set(
    tokensFor([issue.rule, issue.message, issue.match].filter(Boolean).join(' ')),
  );

  return items
    .map((item) => {
      const text = item.text.toLowerCase();
      let score = 0;
      for (const token of issueTokens) {
        if (text.includes(token)) score += token.length;
      }
      return { item, score };
    })
    .filter(({ score }) => score >= 8)
    .sort((a, b) => b.score - a.score)
    .slice(0, 2)
    .map(({ item }) => item);
}

function matchingGuidanceItems(
  issues: ValidationIssue[] | undefined,
  governance: GovernanceTrace | undefined,
): GovernanceTrace['guidanceItems'] {
  if (!issues || issues.length === 0) return undefined;
  const seen = new Set<string>();
  const items: NonNullable<GovernanceTrace['guidanceItems']> = [];
  for (const issue of issues) {
    for (const item of relatedGuidanceItems(issue, governance)) {
      const key = item.id ?? `${item.section}:${item.line}:${item.text}`;
      if (seen.has(key)) continue;
      seen.add(key);
      items.push(item);
    }
  }
  return items.length > 0 ? items : undefined;
}

function issueRuleRef(
  issue: { rule?: string; message?: string; match?: string },
  governance: LoggedGovernanceTrace | undefined,
) {
  return governance?.ruleRefs?.find(
    (entry) =>
      entry.rule === issue.rule &&
      (entry.label === issue.message ||
        (typeof issue.message === 'string' && issue.message.includes(entry.label)) ||
        (typeof issue.match === 'string' && issue.match.includes(entry.label))),
  );
}

function diagnosticGovernanceTrace(
  governance: GovernanceTrace | undefined,
  issues: ValidationIssue[] | undefined,
): LoggedGovernanceTrace | undefined {
  const compact = compactGovernanceTrace(governance);
  if (!compact || !governance) return compact;
  const ruleRefs = matchingRuleRefs(issues, governance);
  const guidanceItems = matchingGuidanceItems(issues, governance);
  return {
    ...compact,
    ...(governance.anchors.length > 0 ? { anchors: governance.anchors } : {}),
    ...(ruleRefs !== undefined ? { ruleRefs } : {}),
    ...(guidanceItems !== undefined ? { guidanceItems } : {}),
  };
}

export async function logGovernanceEvent(event: GovernanceLogEvent): Promise<void> {
  const path = governanceLogPath();
  const governance = shouldExpandGovernance(event)
    ? diagnosticGovernanceTrace(event.governance, event.issues)
    : compactGovernanceTrace(event.governance);
  const record = {
    ts: new Date().toISOString(),
    ...event,
    issues: redactedIssues(event.issues),
    governance,
  };

  writeQueue = writeQueue.then(async () => {
    await mkdir(join(stateDir(), 'logs'), { recursive: true });
    await appendFile(path, `${JSON.stringify(record)}\n`, 'utf-8');
  });
  await writeQueue;
}

export function logGovernanceDecision(input: {
  decision: GovernanceDecision;
  route: string;
  result: ValidationResult;
  provider?: string;
  model?: string;
  client?: string;
  statusCode?: number;
  overrideOffered?: boolean;
  overrideUsed?: boolean;
  governance?: GovernanceTrace;
}): Promise<void> {
  const event: GovernanceLogEvent = {
    event: 'governance_decision',
    decision: input.decision,
    route: input.route,
    issues: input.result.issues,
  };
  if (input.provider !== undefined) event.provider = input.provider;
  if (input.model !== undefined) event.model = input.model;
  if (input.client !== undefined) event.client = input.client;
  if (input.statusCode !== undefined) event.statusCode = input.statusCode;
  if (input.overrideOffered !== undefined) event.overrideOffered = input.overrideOffered;
  if (input.overrideUsed !== undefined) event.overrideUsed = input.overrideUsed;
  if (input.governance !== undefined) event.governance = input.governance;
  return logGovernanceEvent(event);
}

export async function flushGovernanceLog(): Promise<void> {
  await writeQueue;
}

function prettyLine(line: string): string {
  try {
    const parsed = JSON.parse(line) as {
      ts?: string;
      decision?: string;
      route?: string;
      provider?: string;
      model?: string;
      client?: string;
      issues?: Array<{ rule?: string; message?: string; match?: string }>;
      governance?: LoggedGovernanceTrace;
      overrideOffered?: boolean;
      overrideUsed?: boolean;
    };
    const ts = parsed.ts ?? '';
    const decision = (parsed.decision ?? 'event').toUpperCase().padEnd(16);
    const upstream = [parsed.provider, parsed.model].filter(Boolean).join('/');
    const parts = [
      `[${ts}]`,
      decision,
      parsed.client ? `client=${parsed.client}` : undefined,
      upstream ? `upstream=${upstream}` : undefined,
      parsed.route ? `route=${parsed.route}` : undefined,
      parsed.governance
        ? `governance=${parsed.governance.bundleSource}#${parsed.governance.governanceHash ?? 'no-md'}`
        : undefined,
      parsed.overrideOffered ? 'override=offered' : undefined,
      parsed.overrideUsed ? 'override=used' : undefined,
    ].filter(Boolean);
    const guidanceFile = parsed.governance?.governancePath
      ? basename(parsed.governance.governancePath)
      : 'governance.md';
    const rulesFile = parsed.governance?.rulesPath ? basename(parsed.governance.rulesPath) : 'rules.yaml';
    const anchors =
      parsed.governance?.anchors && parsed.governance.anchors.length > 0
        ? `\n  guidance: ${parsed.governance.anchors
            .slice(0, 4)
            .map((anchor) => `${guidanceFile}:${anchor.line}-${anchor.endLine} ${anchor.title}`)
            .join(' | ')}`
        : '';
    const issueText =
      parsed.issues
        ?.map((issue) => {
          const match = issue.match ? ` match="${issue.match}"` : '';
          const ref = issueRuleRef(issue, parsed.governance);
          const source = ref ? ` (${rulesFile}:${ref.line})` : '';
          const id = ref ? ` [${ref.id ?? fallbackId(ref.rule, ref.label)}]` : '';
          const related = relatedGuidance(issue, parsed.governance)
            .map((entry) => `\n    related guidance [${entry.id}]: ${entry.text}`)
            .join('');
          return `\n  - ${issue.rule ?? 'rule'}${id}${source}: ${issue.message ?? ''}${match}${related}`;
        })
        .join('') ?? '';
    return `${parts.join(' ')}${anchors}${issueText}`;
  } catch {
    return line;
  }
}

const COLORS = {
  pass: '\x1b[32m',
  warn: '\x1b[33m',
  block: '\x1b[31m',
  override_allowed: '\x1b[35m',
  dim: '\x1b[2m',
  reset: '\x1b[0m',
} as const;

function colorize(text: string, color: string, enabled: boolean | undefined): string {
  return enabled ? `${color}${text}${COLORS.reset}` : text;
}

function prettyLineWithColor(line: string, color: boolean | undefined): string {
  const plain = prettyLine(line);
  if (!color) return plain;
  try {
    const parsed = JSON.parse(line) as { decision?: string };
    const decision = parsed.decision ?? '';
    const colorCode = COLORS[decision as keyof typeof COLORS] ?? '';
    if (!colorCode) return plain;
    return plain
      .split('\n')
      .map((part, idx) => {
        if (idx === 0) return colorize(part, colorCode, true);
        if (part.trimStart().startsWith('-')) return colorize(part, colorCode, true);
        return colorize(part, COLORS.dim, true);
      })
      .join('\n');
  } catch {
    return plain;
  }
}

function writeLogLines(
  stream: NodeJS.WritableStream,
  content: string,
  pretty: boolean | undefined,
  color: boolean | undefined,
): void {
  const lines = content
    .trimEnd()
    .split('\n')
    .filter(Boolean)
    .map((line) => (pretty ? prettyLineWithColor(line, color) : line));
  if (lines.length > 0) stream.write(`${lines.join('\n')}\n`);
}

export async function printGovernanceLog(options: {
  follow?: boolean;
  lines?: number;
  pretty?: boolean;
  color?: boolean;
  decision?: GovernanceDecision;
  stream?: NodeJS.WritableStream;
} = {}): Promise<void> {
  const stream = options.stream ?? process.stdout;
  const path = governanceLogPath();
  const lines = options.lines ?? 50;

  let position = 0;
  try {
    const existing = await stat(path);
    position = existing.size;
    const content = await readFile(path, 'utf-8');
    const logLines = content.trimEnd().split('\n').filter(Boolean);
    const filtered = options.decision
      ? logLines.filter((line) => {
          try {
            return (JSON.parse(line) as { decision?: string }).decision === options.decision;
          } catch {
            return false;
          }
        })
      : logLines;
    const tail = filtered.slice(-lines).join('\n');
    writeLogLines(stream, tail, options.pretty, options.color);
  } catch {
    stream.write(`No governance log yet: ${path}\n`);
  }

  if (!options.follow) return;

  stream.write(`Following ${path}\n`);
  setInterval(async () => {
    try {
      const current = await stat(path);
      if (current.size <= position) return;
      const reader = createReadStream(path, { start: position, end: current.size - 1 });
      position = current.size;
      if (!options.pretty) {
        reader.pipe(stream, { end: false });
        return;
      }
      let chunk = '';
      reader.setEncoding('utf-8');
      reader.on('data', (data) => {
        chunk += data;
      });
      reader.on('end', () => {
        const filtered = options.decision
          ? chunk
              .trimEnd()
              .split('\n')
              .filter((line) => {
                try {
                  return (JSON.parse(line) as { decision?: string }).decision === options.decision;
                } catch {
                  return false;
                }
              })
              .join('\n')
          : chunk;
        writeLogLines(stream, filtered, true, options.color);
      });
    } catch {
      /* wait for the file to appear */
    }
  }, 500);
}

function increment(map: Map<string, number>, key: string): void {
  map.set(key, (map.get(key) ?? 0) + 1);
}

function sortedCounts(map: Map<string, number>): Array<[string, number]> {
  return [...map.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
}

export async function printGovernanceSummary(options: {
  lines?: number;
  governanceHash?: string;
  decision?: GovernanceDecision;
  stream?: NodeJS.WritableStream;
} = {}): Promise<void> {
  const stream = options.stream ?? process.stdout;
  const path = governanceLogPath();
  let raw = '';
  try {
    raw = await readFile(path, 'utf-8');
  } catch {
    stream.write(`No governance log yet: ${path}\n`);
    return;
  }

  const parsedRecords = raw
    .trim()
    .split('\n')
    .filter(Boolean)
    .flatMap((line) => {
      try {
        return [JSON.parse(line) as GovernanceLogEvent & { ts?: string }];
      } catch {
        return [];
      }
    });
  const hashFilteredRecords = options.governanceHash
    ? parsedRecords.filter((record) => record.governance?.governanceHash === options.governanceHash)
    : parsedRecords;
  const filteredRecords = options.decision
    ? hashFilteredRecords.filter((record) => record.decision === options.decision)
    : hashFilteredRecords;
  const records = filteredRecords.slice(-(options.lines ?? 500));

  const decisions = new Map<string, number>();
  const rules = new Map<string, number>();
  const guidance = new Map<string, number>();
  const byModel = new Map<string, number>();
  const warningsByModel = new Map<string, number>();
  const byClient = new Map<string, number>();
  const warningsByClient = new Map<string, number>();
  let warningCount = 0;

  for (const record of records) {
    increment(decisions, record.decision);
    const model = [record.provider, record.model].filter(Boolean).join('/') || 'unknown';
    const client = record.client ?? 'unknown';
    increment(byModel, model);
    increment(byClient, client);
    if (record.decision === 'warn' || record.decision === 'block') {
      warningCount += 1;
      increment(warningsByModel, model);
      increment(warningsByClient, client);
    }
    for (const issue of record.issues ?? []) {
      const ref = issueRuleRef(issue, record.governance);
      const key = ref
        ? `${ref.id ?? fallbackId(ref.rule, ref.label)} (${basename(record.governance?.rulesPath ?? 'rules.yaml')}:${ref.line})`
        : `${issue.rule}: ${issue.message}`;
      increment(rules, key);
      for (const related of relatedGuidance(issue, record.governance)) {
        increment(guidance, related.id);
      }
    }
  }

  const filters = [
    options.governanceHash ? `governance=${options.governanceHash}` : undefined,
    options.decision ? `decision=${options.decision}` : undefined,
  ].filter(Boolean);
  const filterText = filters.length > 0 ? `, ${filters.join(', ')}` : '';
  stream.write(`Governance log summary (${records.length} event${records.length === 1 ? '' : 's'}${filterText})\n\n`);
  stream.write('Decisions\n');
  for (const [decision, count] of sortedCounts(decisions)) {
    stream.write(`  ${decision.padEnd(16)} ${count}\n`);
  }
  const warningRate = records.length > 0 ? (warningCount / records.length) * 100 : 0;
  stream.write(`\nWarning/block rate: ${warningRate.toFixed(1)}% (${warningCount}/${records.length})\n`);

  stream.write('\nBy model\n');
  for (const [model, count] of sortedCounts(byModel).slice(0, 10)) {
    const warnings = warningsByModel.get(model) ?? 0;
    const rate = count > 0 ? (warnings / count) * 100 : 0;
    stream.write(`  ${String(count).padStart(4)}  ${model}  warn/block=${warnings} (${rate.toFixed(1)}%)\n`);
  }

  stream.write('\nBy client\n');
  for (const [client, count] of sortedCounts(byClient).slice(0, 10)) {
    const warnings = warningsByClient.get(client) ?? 0;
    const rate = count > 0 ? (warnings / count) * 100 : 0;
    stream.write(`  ${String(count).padStart(4)}  ${client}  warn/block=${warnings} (${rate.toFixed(1)}%)\n`);
  }

  stream.write('\nTop rules\n');
  const ruleCounts = sortedCounts(rules).slice(0, 10);
  if (ruleCounts.length === 0) stream.write('  none\n');
  for (const [rule, count] of ruleCounts) {
    stream.write(`  ${String(count).padStart(4)}  ${rule}\n`);
  }

  stream.write('\nTop related guidance\n');
  const guidanceCounts = sortedCounts(guidance).slice(0, 10);
  if (guidanceCounts.length === 0) stream.write('  none\n');
  for (const [item, count] of guidanceCounts) {
    stream.write(`  ${String(count).padStart(4)}  ${item}\n`);
  }
}
