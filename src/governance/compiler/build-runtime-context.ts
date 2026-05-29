import { resolveSourceOrder, extractRules } from './resolve-priority.js';
import type { GovernanceFile, CompiledContext, ContextSource } from '../../types/governance.js';

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

export function buildRuntimeContext(files: GovernanceFile[]): CompiledContext {
  const ordered = resolveSourceOrder(files);
  const rules = extractRules(ordered);

  const sections: string[] = [FRAMING];

  if (ordered.length > 0) {
    sections.push('\n---\n\n# Operator-wide guidance\n');
    for (const file of ordered) {
      if (!file.content.trim()) continue;
      sections.push(`## ${SOURCE_LABELS[file.source]}\n\n${file.content.trim()}\n`);
    }
  }

  return {
    systemMessage: sections.join('\n'),
    rules,
    sources: ordered.map((f) => f.source),
    overrides: [],
  };
}
