export type ContextSource = 'global';

export interface GovernanceFile {
  source: ContextSource;
  /** Absolute filesystem path the file was loaded from (e.g. <repo>/data/governance.md). */
  sourcePath: string;
  content: string;
  frontMatter?: Record<string, unknown>;
}

export interface DangerousPattern {
  pattern: string;
  severity: 'warn' | 'block';
  message?: string;
}

export interface RuleSet {
  forbiddenDependencies: string[];
  forbiddenFrameworks: string[];
  dangerousPatterns: DangerousPattern[];
  typescriptRules: {
    noAny: boolean;
    requireStrict: boolean;
  };
}

export interface CompiledContext {
  systemMessage: string;
  rules: RuleSet;
  sources: ContextSource[];
  overrides: OverrideRecord[];
}

export interface OverrideRecord {
  source: ContextSource;
  key: string;
  value: string;
  overrides: ContextSource;
}
