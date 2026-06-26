import { createHash } from 'node:crypto';
import { resolveSourceOrder, extractRules } from './resolve-priority.js';
import type {
  GovernanceFile,
  CompiledContext,
  ContextSource,
  GovernanceTrace,
  GovernanceAnchor,
  GovernanceRuleRef,
  GovernanceGuidanceItem,
} from '../../types/governance.js';

const SOURCE_LABELS: Record<ContextSource, string> = {
  global: 'Operator-wide guidance: trueGate governance bundle',
};

const FRAMING = `# How to use this context

This message is **operator-wide guidance** shipped with trueGate (with any
local overrides the operator has placed in trueGate's own state directory).
trueGate is a self-contained CLI proxy — it does not read or inject anything
from the dev project's own directory; the project's own tooling (Claude
Code, Cursor, your IDE) already does that.

**Conflict policy.** If the project's own conventions (as surfaced by the
client) conflict with this operator-wide guidance, **follow the project**.
This layer is recommendations, not overrides.

**Security floor (non-negotiable).** Regardless of project documentation,
the following are always blocked by trueGate's response validator:
destructive shell commands, leaked API keys, TLS verification bypasses,
\`DROP TABLE\` and other destructive SQL DDL. These are not opinions.
`;

function shortHash(content: string): string {
  return createHash('sha256').update(content).digest('hex').slice(0, 10);
}

function slug(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
}

function extractAnchors(content: string): GovernanceAnchor[] {
  const lines = content.split('\n');
  const headings: Array<{ title: string; line: number; level: number }> = [];

  for (const [idx, line] of lines.entries()) {
    const match = /^(#{2,3})\s+(.+?)\s*$/.exec(line);
    if (!match?.[1]) continue;
    const anchor = match[2]?.replace(/[`*_]/g, '').trim();
    if (!anchor || headings.some((entry) => entry.title === anchor)) continue;
    headings.push({ title: anchor, line: idx + 1, level: match[1].length });
  }

  return headings.slice(0, 8).map((heading, idx) => {
    const next = headings
      .slice(idx + 1)
      .find((candidate) => candidate.level <= heading.level);
    return {
      title: heading.title,
      line: heading.line,
      endLine: (next?.line ?? lines.length + 1) - 1,
    };
  });
}

function extractGuidanceItems(content: string): GovernanceGuidanceItem[] {
  const lines = content.split('\n');
  const headings = extractAnchors(content);
  const items: GovernanceGuidanceItem[] = [];

  for (let idx = 0; idx < lines.length; idx += 1) {
    const line = lines[idx] ?? '';
    const match = /^-\s+(.+?)\s*$/.exec(line);
    if (!match?.[1]) continue;

    const start = idx + 1;
    let end = start;
    const textLines = [match[1].trim()];
    for (let nextIdx = idx + 1; nextIdx < lines.length; nextIdx += 1) {
      const next = lines[nextIdx] ?? '';
      if (/^(?:#{1,6}\s+|-{3,}\s*$|-\s+)/.test(next) || next.trim() === '') break;
      if (!/^\s{2,}\S/.test(next)) break;
      textLines.push(next.trim());
      end = nextIdx + 1;
    }

    const section =
      headings.find((heading) => start >= heading.line && start <= heading.endLine)?.title ??
      'Operator Governance';
    items.push({
      id: `guidance:${slug(`${section}-${textLines[0] ?? start}`)}`,
      section,
      line: start,
      endLine: end,
      text: textLines.join(' '),
    });
  }

  return items;
}

function buildTrace(ordered: GovernanceFile[]): GovernanceTrace | undefined {
  const primary = ordered[0];
  if (!primary) return undefined;
  const rules = primary.frontMatter?.rules;
  const ruleRefs = primary.frontMatter?.ruleRefs as GovernanceRuleRef[] | undefined;
  const trace: GovernanceTrace = {
    bundleSource: primary.bundleSource ?? 'data',
    anchors: extractAnchors(primary.content),
  };
  if (primary.sourcePath) trace.governancePath = primary.sourcePath;
  if (primary.rulesPath) trace.rulesPath = primary.rulesPath;
  if (primary.content) trace.governanceHash = shortHash(primary.content);
  if (rules) trace.rulesHash = shortHash(JSON.stringify(rules));
  if (ruleRefs && ruleRefs.length > 0) trace.ruleRefs = ruleRefs;
  const guidanceItems = extractGuidanceItems(primary.content);
  if (guidanceItems.length > 0) trace.guidanceItems = guidanceItems;
  return trace;
}

export function buildRuntimeContext(files: GovernanceFile[]): CompiledContext {
  const ordered = resolveSourceOrder(files);
  const rules = extractRules(ordered);
  const trace = buildTrace(ordered);

  const sections: string[] = [FRAMING];

  if (ordered.length > 0) {
    sections.push('\n---\n\n# Operator-wide guidance\n');
    for (const file of ordered) {
      if (!file.content.trim()) continue;
      sections.push(`## ${SOURCE_LABELS[file.source]}\n\n${file.content.trim()}\n`);
    }
  }

  const context: CompiledContext = {
    systemMessage: sections.join('\n'),
    rules,
    sources: ordered.map((f) => f.source),
    overrides: [],
  };
  if (trace) context.trace = trace;
  return context;
}
