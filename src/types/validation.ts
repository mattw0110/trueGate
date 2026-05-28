export type Severity = 'warn' | 'block' | 'pass';

export interface ValidationIssue {
  severity: Severity;
  rule: string;
  message: string;
  match?: string;
}

export interface ValidationResult {
  severity: Severity;
  issues: ValidationIssue[];
  blocked: boolean;
}
