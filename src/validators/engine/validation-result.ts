import type { ValidationResult, ValidationIssue, Severity } from '../../types/validation.js';

export function buildValidationResult(issues: ValidationIssue[]): ValidationResult {
  const blocked = issues.some((i) => i.severity === 'block');
  const severity: Severity = blocked ? 'block' : issues.length > 0 ? 'warn' : 'pass';
  return { severity, issues, blocked };
}
