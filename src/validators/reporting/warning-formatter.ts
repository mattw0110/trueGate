import { WARNING_PREFIX, BLOCK_PREFIX } from '../../config/constants.js';
import type { ValidationResult, ValidationIssue } from '../../types/validation.js';

function formatIssue(issue: ValidationIssue): string {
  const prefix = issue.severity === 'block' ? '🚫' : '⚠';
  const matchPart = issue.match ? ` (matched: \`${issue.match}\`)` : '';
  return `${prefix} [${issue.rule}] ${issue.message}${matchPart}`;
}

export function formatWarnings(result: ValidationResult): string {
  if (result.severity === 'pass') return '';

  const header = result.blocked ? `\n\n---\n${BLOCK_PREFIX}` : `\n\n---\n${WARNING_PREFIX}`;
  const lines = result.issues.map(formatIssue);

  return `${header}\n${lines.join('\n')}\n---`;
}

export function formatBlockedResponse(result: ValidationResult): string {
  const lines = result.issues.filter((i) => i.severity === 'block').map(formatIssue);

  return (
    `${BLOCK_PREFIX}: This response has been blocked by trueGate governance rules.\n\n` +
    `The requested action violates one or more governance policies:\n\n` +
    lines.join('\n') +
    `\n\nPlease revise your request to comply with your project's governance rules.`
  );
}
