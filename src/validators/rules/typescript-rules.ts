import type { ValidationIssue } from '../../types/validation.js';

const ANY_RE = /:\s*any\b/;
const TSCONFIG_RE = /tsconfig/i;
const STRICT_RE = /"strict"\s*:\s*true/;

export function checkTypescriptRules(
  content: string,
  rules: { noAny: boolean; requireStrict: boolean },
): ValidationIssue[] {
  const issues: ValidationIssue[] = [];

  if (rules.noAny && ANY_RE.test(content)) {
    issues.push({
      severity: 'warn',
      rule: 'typescript-rules',
      message: 'Use of `any` type detected — prefer explicit types',
      match: ': any',
    });
  }

  if (rules.requireStrict && TSCONFIG_RE.test(content) && !STRICT_RE.test(content)) {
    issues.push({
      severity: 'warn',
      rule: 'typescript-rules',
      message: 'tsconfig missing "strict": true — strict mode is required',
    });
  }

  return issues;
}
