export type ContextSource = 'global';

export interface GovernanceFile {
  source: ContextSource;
  /** Absolute filesystem path the file was loaded from (e.g. <repo>/data/governance.md). */
  sourcePath: string;
  rulesPath?: string;
  bundleSource?: string;
  content: string;
  frontMatter?: Record<string, unknown>;
}

export interface DangerousPattern {
  id?: string;
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
  trace?: GovernanceTrace;
}

export interface GovernanceAnchor {
  title: string;
  line: number;
  endLine: number;
}

export interface GovernanceRuleRef {
  id: string;
  rule: string;
  label: string;
  line: number;
}

export interface GovernanceGuidanceItem {
  id: string;
  section: string;
  line: number;
  endLine: number;
  text: string;
}

export interface GovernanceTrace {
  bundleSource: string;
  governancePath?: string;
  rulesPath?: string;
  governanceHash?: string;
  rulesHash?: string;
  anchors: GovernanceAnchor[];
  ruleRefs?: GovernanceRuleRef[];
  guidanceItems?: GovernanceGuidanceItem[];
}

export interface OverrideRecord {
  source: ContextSource;
  key: string;
  value: string;
  overrides: ContextSource;
}
