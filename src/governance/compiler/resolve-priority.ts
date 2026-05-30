import type { DangerousPattern, GovernanceFile, RuleSet } from '../../types/governance.js';
import { RulesYamlSchema } from '../schemas/rules-schema.js';

/**
 * trueGate is operator-wide only — `<repo>/data/` (with `<repo>/.state/`
 * overrides) is the single source. `resolveSourceOrder` is preserved as a
 * no-op identity for callers that still expect a sorted list.
 */
export function resolveSourceOrder(files: GovernanceFile[]): GovernanceFile[] {
  return [...files];
}

/**
 * Aggregate machine-enforced rules from operator-wide rules.yaml.
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
      if (typeof p === 'string') {
        base.dangerousPatterns.push({ pattern: p, severity: 'block' });
      } else {
        const entry: DangerousPattern = { pattern: p.pattern, severity: p.severity };
        if (p.message !== undefined) entry.message = p.message;
        base.dangerousPatterns.push(entry);
      }
    }

    base.typescriptRules = {
      noAny: base.typescriptRules.noAny || r.typescriptRules.noAny,
      requireStrict: base.typescriptRules.requireStrict || r.typescriptRules.requireStrict,
    };
  }

  base.forbiddenDependencies = Array.from(new Set(base.forbiddenDependencies));
  base.forbiddenFrameworks = Array.from(new Set(base.forbiddenFrameworks));
  const seen = new Set<string>();
  base.dangerousPatterns = base.dangerousPatterns.filter((p) => {
    if (seen.has(p.pattern)) return false;
    seen.add(p.pattern);
    return true;
  });

  return base;
}
