import type { CompiledContext, ContextSource } from '../../types/governance.js';

const SOURCE_LABELS: Record<ContextSource, string> = {
  global: 'trueGate governance bundle (data/ + .state/ overrides)',
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
  const trace = context.trace;
  const traceLines = trace
    ? [
        '',
        '## Active Governance Trace\n',
        `- Bundle source: ${trace.bundleSource}`,
        ...(trace.governancePath ? [`- Governance file: ${trace.governancePath}`] : []),
        ...(trace.rulesPath ? [`- Rules file: ${trace.rulesPath}`] : []),
        ...(trace.governanceHash ? [`- Governance hash: ${trace.governanceHash}`] : []),
        ...(trace.rulesHash ? [`- Rules hash: ${trace.rulesHash}`] : []),
        `- Guidance anchors: ${
          trace.anchors.length > 0
            ? trace.anchors
                .map((anchor) => `${anchor.title} (lines ${anchor.line}-${anchor.endLine})`)
                .join(', ')
            : 'none'
        }`,
      ]
    : [];
  const lines = [
    '## Active Governance Sources\n',
    ...sourceLabels.map((s) => `- ${s}`),
    ...traceLines,
    '',
    '## Active Rules\n',
    `- Forbidden dependencies: ${context.rules.forbiddenDependencies.length > 0 ? context.rules.forbiddenDependencies.join(', ') : 'none'}`,
    `- Forbidden frameworks: ${context.rules.forbiddenFrameworks.length > 0 ? context.rules.forbiddenFrameworks.join(', ') : 'none'}`,
    `- Dangerous patterns: ${context.rules.dangerousPatterns.length} pattern(s)`,
    `- TypeScript: noAny=${context.rules.typescriptRules.noAny}, requireStrict=${context.rules.typescriptRules.requireStrict}`,
  ];

  return lines.join('\n');
}
