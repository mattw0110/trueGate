import type { ValidationIssue } from '../../types/validation.js';

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
  extraPatterns: string[] = [],
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

  for (const pattern of extraPatterns) {
    try {
      const re = new RegExp(pattern, 'i');
      const match = re.exec(content);
      if (match) {
        issues.push({
          severity: 'block',
          rule: 'dangerous-patterns',
          message: `Blocked by governance pattern: ${pattern}`,
          match: match[0],
        });
      }
    } catch {
      // invalid regex in rules.yaml — skip silently
    }
  }

  return issues;
}
