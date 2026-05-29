export type ContextSource = 'global';

export interface GovernanceFile {
  source: ContextSource;
  /** Absolute filesystem path the file was loaded from (e.g. ~/.truegate). */
  sourcePath: string;
  content: string;
  frontMatter?: Record<string, unknown>;
}

export interface RuleSet {
  forbiddenDependencies: string[];
  forbiddenFrameworks: string[];
  dangerousPatterns: string[];
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
