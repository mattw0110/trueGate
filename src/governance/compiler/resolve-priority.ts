import type { GovernanceFile, RuleSet } from '../../types/governance.js';
import { RulesYamlSchema } from '../schemas/rules-schema.js';

/**
 * trueGate is operator-wide only — `~/.truegate/` is the single source.
 * `resolveSourceOrder` is preserved as a no-op identity for callers that
 * still expect a sorted list.
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
