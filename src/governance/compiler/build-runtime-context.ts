import { resolveSourceOrder, extractRules } from './resolve-priority.js';
import type { GovernanceFile, CompiledContext, ContextSource } from '../../types/governance.js';

const SOURCE_LABELS: Record<ContextSource, string> = {
  claude: 'Project: CLAUDE.md',
  agents: 'Project: AGENTS.md',
  cursor: 'Project: .cursor/rules/',
  global: 'Operator-wide guidance: ~/.truegate/governance.md',
};

const PROJECT_SOURCES: ContextSource[] = ['claude', 'agents', 'cursor'];

const CONFLICT_FRAMING = `# How to use this context

This message has two layers, in order:

1. **PROJECT documentation** (from this repo's CLAUDE.md / AGENTS.md / .cursor/rules/).
   These are the project's own conventions — the source of truth for THIS codebase.
2. **OPERATOR-WIDE guidance** (from ~/.truegate/, set by the trueGate operator).
   These are recommendations that apply across every project the operator works on.

**Conflict policy.** If a recommendation in the operator-wide section conflicts
with what the project says, **follow the project** — and briefly note the
conflict in your response so the developer is aware. The operator-wide layer
defers to project conventions; it does not override them.

**Security floor (non-negotiable).** Regardless of project documentation, the
following are always blocked by trueGate's response validator:
destructive shell commands, leaked API keys, TLS verification bypasses,
\`DROP TABLE\` and other destructive SQL DDL. These are not opinions.
`;

export function buildRuntimeContext(files: GovernanceFile[]): CompiledContext {
  const ordered = resolveSourceOrder(files);
  const rules = extractRules(ordered);

  const projectFiles = ordered.filter((f) => PROJECT_SOURCES.includes(f.source));
  const operatorFiles = ordered.filter((f) => f.source === 'global');

  const sections: string[] = [CONFLICT_FRAMING];

  if (projectFiles.length > 0) {
    sections.push('\n---\n\n# Project documentation\n');
    for (const file of projectFiles) {
      if (!file.content.trim()) continue;
      sections.push(`## ${SOURCE_LABELS[file.source]}\n\n${file.content.trim()}\n`);
    }
  } else {
    sections.push(
      '\n---\n\n# Project documentation\n\n(none — this project has no CLAUDE.md, AGENTS.md, or .cursor/rules/)\n',
    );
  }

  if (operatorFiles.length > 0) {
    sections.push('\n---\n\n# Operator-wide guidance (defer to project on conflict)\n');
    for (const file of operatorFiles) {
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
