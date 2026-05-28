import type { ValidationIssue } from '../../types/validation.js';

export function checkForbiddenFrameworks(content: string, blocklist: string[]): ValidationIssue[] {
  const issues: ValidationIssue[] = [];

  for (const framework of blocklist) {
    if (content.toLowerCase().includes(framework.toLowerCase())) {
      issues.push({
        severity: 'warn',
        rule: 'forbidden-frameworks',
        message: `Forbidden framework mentioned: ${framework}`,
        match: framework,
      });
    }
  }

  return issues;
}
