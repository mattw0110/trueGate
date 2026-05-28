import type { GovernanceFile, ContextSource, RuleSet } from '../../types/governance.js';
import { RulesYamlSchema } from '../schemas/rules-schema.js';

// PROJECT-FIRST priority. trueGate respects the project's own conventions
// (CLAUDE.md, AGENTS.md, .cursor/rules) above the operator's global guidance.
//
// Operator-wide RULES (rules.yaml, machine-enforced) still fire — they are
// not opinions, they are non-negotiable safety floors. But the operator's
// PROSE (governance.md) is presented as guidance that defers to the project.
const SOURCE_PRIORITY: ContextSource[] = ['claude', 'agents', 'cursor', 'global'];

export function resolveSourceOrder(files: GovernanceFile[]): GovernanceFile[] {
  return [...files].sort((a, b) => {
    const ai = SOURCE_PRIORITY.indexOf(a.source);
    const bi = SOURCE_PRIORITY.indexOf(b.source);
    return ai - bi;
  });
}

/**
 * Aggregate machine-enforced rules. ONLY the operator-wide `global` source
 * provides a rules.yaml. Per-project trueGate artifacts no longer exist.
 */
export function extractRules(files: GovernanceFile[]): RuleSet {
  const base: RuleSet = {
    forbiddenDependencies: [],
    forbiddenFrameworks: [],
    dangerousPatterns: [],
    typescriptRules: { noAny: true, requireStrict: true },
  };

  for (const file of files) {
    if (file.source !== 'global') continue;
    const rules = file.frontMatter?.['rules'];
    if (!rules) continue;

    const parsed = RulesYamlSchema.safeParse(rules);
    if (!parsed.success) continue;

    const r = parsed.data;
    base.forbiddenDependencies.push(...r.forbiddenDependencies);
    base.forbiddenFrameworks.push(...r.forbiddenFrameworks);

    for (const p of r.dangerousPatterns) {
      if (typeof p === 'string') base.dangerousPatterns.push(p);
      else base.dangerousPatterns.push(p.pattern);
    }

    base.typescriptRules = {
      noAny: base.typescriptRules.noAny || r.typescriptRules.noAny,
      requireStrict: base.typescriptRules.requireStrict || r.typescriptRules.requireStrict,
    };
  }

  base.forbiddenDependencies = Array.from(new Set(base.forbiddenDependencies));
  base.forbiddenFrameworks = Array.from(new Set(base.forbiddenFrameworks));
  base.dangerousPatterns = Array.from(new Set(base.dangerousPatterns));

  return base;
}
