import { checkDangerousPatterns } from '../rules/dangerous-patterns.js';
import { checkForbiddenDependencies } from '../rules/forbidden-dependencies.js';
import { checkForbiddenFrameworks } from '../rules/forbidden-frameworks.js';
import { checkTypescriptRules } from '../rules/typescript-rules.js';
import { buildValidationResult } from './validation-result.js';
import type { ValidationResult } from '../../types/validation.js';
import type { RuleSet } from '../../types/governance.js';

export function validateResponse(content: string, rules: RuleSet): ValidationResult {
  const issues = [
    ...checkDangerousPatterns(content, rules.dangerousPatterns),
    ...checkForbiddenDependencies(content, rules.forbiddenDependencies),
    ...checkForbiddenFrameworks(content, rules.forbiddenFrameworks),
    ...checkTypescriptRules(content, rules.typescriptRules),
  ];

  return buildValidationResult(issues);
}
