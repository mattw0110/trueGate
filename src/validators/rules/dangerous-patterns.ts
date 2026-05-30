import type { ValidationIssue } from '../../types/validation.js';
import type { DangerousPattern } from '../../types/governance.js';

const BUILT_IN_PATTERNS: Array<{ re: RegExp; message: string }> = [
  { re: /rm\s+-rf\s+\//i, message: 'Destructive rm -rf / command detected' },
  { re: /rm\s+-rf\s+~\b/i, message: 'Destructive rm -rf ~/ command detected' },
  { re: /curl[^|]+\|\s*(?:ba)?sh\b/i, message: 'Pipe-to-shell pattern detected' },
  { re: /wget[^|]+\|\s*(?:ba)?sh\b/i, message: 'Pipe-to-shell (wget) pattern detected' },
  { re: /sk-[a-zA-Z0-9]{20,}/, message: 'Possible hardcoded OpenAI API key detected' },
  { re: /sk-ant-[a-zA-Z0-9-]{20,}/, message: 'Possible hardcoded Anthropic API key detected' },
  { re: /DROP\s+TABLE/i, message: 'Destructive SQL DDL detected' },
  { re: /format\s+[cC]:\s*\/y/i, message: 'Destructive format command detected' },
  { re: /mkfs\.[a-z]+\s+\/dev\/s[da]/i, message: 'Destructive mkfs command detected' },
];

export function checkDangerousPatterns(
  content: string,
  extraPatterns: DangerousPattern[] = [],
): ValidationIssue[] {
  const issues: ValidationIssue[] = [];

  for (const { re, message } of BUILT_IN_PATTERNS) {
    const match = re.exec(content);
    if (match) {
      issues.push({
        severity: 'block',
        rule: 'dangerous-patterns',
        message,
        match: match[0],
      });
    }
  }

  for (const entry of extraPatterns) {
    try {
      // Patterns are case-sensitive by default; rules.yaml can opt in
      // case-insensitivity per-pattern with a `(?i)` prefix (JS RegExp
      // doesn't support inline flags, so strip and translate to the `i` flag).
      let source = entry.pattern;
      let flags = '';
      if (source.startsWith('(?i)')) {
        source = source.slice(4);
        flags = 'i';
      }
      const re = new RegExp(source, flags);
      const match = re.exec(content);
      if (match) {
        issues.push({
          severity: entry.severity,
          rule: 'dangerous-patterns',
          message:
            entry.message ??
            `${entry.severity === 'block' ? 'Blocked' : 'Flagged'} by governance pattern: ${entry.pattern}`,
          match: match[0],
        });
      }
    } catch {
      // invalid regex in rules.yaml — skip silently
    }
  }

  return issues;
}
