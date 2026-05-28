import type { ValidationIssue } from '../../types/validation.js';

export function checkForbiddenDependencies(
  content: string,
  blocklist: string[],
): ValidationIssue[] {
  const issues: ValidationIssue[] = [];

  for (const dep of blocklist) {
    const escaped = dep.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const patterns = [
      new RegExp(`npm\\s+install[^\\n]*\\b${escaped}\\b`, 'i'),
      new RegExp(`npm\\s+i[^\\n]*\\b${escaped}\\b`, 'i'),
      new RegExp(`yarn\\s+add[^\\n]*\\b${escaped}\\b`, 'i'),
      new RegExp(`pnpm\\s+add[^\\n]*\\b${escaped}\\b`, 'i'),
      new RegExp(`import\\s+['"]\s*${escaped}['"']`, 'i'),
      new RegExp(`from\\s+['"]\s*${escaped}['"']`, 'i'),
      new RegExp(`require\\(['"]\s*${escaped}['"']\\)`, 'i'),
    ];

    for (const re of patterns) {
      const match = re.exec(content);
      if (match) {
        issues.push({
          severity: 'warn',
          rule: 'forbidden-dependencies',
          message: `Forbidden dependency referenced: ${dep}`,
          match: match[0],
        });
        break;
      }
    }
  }

  return issues;
}
