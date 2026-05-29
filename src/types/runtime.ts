export type ProviderName =
  | 'openai'
  | 'anthropic'
  | 'ollama'
  | 'lmstudio'
  | 'github-copilot'
  | 'cliproxy'
  | 'custom';

export type TrueGateMode = 'auto' | 'locked';

export interface TrueGateConfig {
  port: number;
  logLevel: string;
  projectRoot: string;
  /**
   * Locked-mode provider OR the default provider used to construct the
   * registry's locked fallback when --no-auto / mode='locked'. In auto mode
   * this still indicates the operator's explicit `--provider` choice (which
   * overrides per-model routing) — when absent, every reachable upstream is
   * eligible.
   */
  provider: ProviderName;
  /** Explicit flag for whether the operator passed `--provider`. */
  providerForced?: boolean;
  /** 'auto' (default) probes everything at startup. 'locked' uses only `provider`. */
  mode?: TrueGateMode;
  /** Optional manual overrides: model → provider name. Beats pattern matching. */
  modelOverrides?: Record<string, ProviderName>;
  /** Priority order, lower index wins. Defaults to plan §2 ordering. */
  providerPriority?: ProviderName[];
  openAiApiKey?: string;
  anthropicApiKey?: string;
  githubToken?: string;
  upstreamUrl?: string;
  upstreamApiKey?: string;
  /**
   * When true, drop the client's incoming system prompt and replace it with
   * trueGate's compiled governance only. Useful when an upstream (e.g.
   * CLIProxyAPI's Claude Code session) injects a large, fixed system prompt
   * that overshadows your governance.
   *
   * WARNING: Stripping the client system prompt will break agent CLIs that
   * rely on their baked-in tool descriptions and behaviour. Use for testing
   * governance in isolation, not for general production.
   */
  stripClientSystem?: boolean;
  /**
   * Text appended on its own line at the end of every successful response so
   * users can visually confirm the request went through trueGate. Default:
   * "— trueGate". Set to empty string or disable via --no-response-marker
   * to suppress.
   */
  responseMarker?: string;
}

export interface UpstreamEndpoint {
  provider: ProviderName;
  baseUrl: string;
  apiKey?: string;
  models: string[];
  priority: number;
  reachable: boolean;
  /** Optional diagnostic — error string from the startup probe when unreachable. */
  err?: string;
}

export interface UpstreamRegistry {
  endpoints: UpstreamEndpoint[];
  mode: TrueGateMode;
  /** If set, every request is forced to this provider regardless of model. */
  forcedProvider?: ProviderName;
  /** Effective priority order used to break ties. */
  priority: ProviderName[];
  /** Explicit per-model overrides applied before pattern matching. */
  modelOverrides: Record<string, ProviderName>;
}

export interface ServerOptions {
  config: TrueGateConfig;
  logger?: boolean;
}
