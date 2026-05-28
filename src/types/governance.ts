export type ContextSource = 'claude' | 'agents' | 'cursor' | 'global';

export interface GovernanceFile {
  source: ContextSource;
  projectRoot: string;
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
