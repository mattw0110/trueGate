import type { CompiledContext, ContextSource } from '../../types/governance.js';

const SOURCE_LABELS: Record<ContextSource, string> = {
  claude: 'CLAUDE.md (project)',
  agents: 'AGENTS.md (project)',
  cursor: '.cursor/rules/ (project)',
  global: '~/.truegate/governance.md (operator-wide, defers to project)',
};

export function formatOverrideReport(context: CompiledContext): string {
  if (context.overrides.length === 0) return '';

  const lines = ['## Governance Override Report\n'];
  for (const o of context.overrides) {
    const source = SOURCE_LABELS[o.source] ?? o.source;
    const overrides = SOURCE_LABELS[o.overrides] ?? o.overrides;
    lines.push(`- \`${o.key}\` from **${source}** overrides **${overrides}**: ${o.value}`);
  }

  return lines.join('\n');
}

export function formatContextSummary(context: CompiledContext): string {
  const sourceLabels = context.sources.map((s) => SOURCE_LABELS[s] ?? s);
  const lines = [
    '## Active Governance Sources\n',
    ...sourceLabels.map((s) => `- ${s}`),
    '',
    '## Active Rules\n',
    `- Forbidden dependencies: ${context.rules.forbiddenDependencies.length > 0 ? context.rules.forbiddenDependencies.join(', ') : 'none'}`,
    `- Forbidden frameworks: ${context.rules.forbiddenFrameworks.length > 0 ? context.rules.forbiddenFrameworks.join(', ') : 'none'}`,
    `- Dangerous patterns: ${context.rules.dangerousPatterns.length} pattern(s)`,
    `- TypeScript: noAny=${context.rules.typescriptRules.noAny}, requireStrict=${context.rules.typescriptRules.requireStrict}`,
  ];

  return lines.join('\n');
}
