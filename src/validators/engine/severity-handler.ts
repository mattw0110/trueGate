import type { ValidationResult } from '../../types/validation.js';

export function shouldBlock(result: ValidationResult): boolean {
  return result.blocked;
}

export function hasWarnings(result: ValidationResult): boolean {
  return result.issues.some((i) => i.severity === 'warn');
}
