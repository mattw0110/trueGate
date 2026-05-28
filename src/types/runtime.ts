export type ProviderName =
  | 'openai'
  | 'anthropic'
  | 'ollama'
  | 'lmstudio'
  | 'github-copilot'
  | 'cliproxy'
  | 'custom';

export interface TrueGateConfig {
  port: number;
  logLevel: string;
  projectRoot: string;
  provider: ProviderName;
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

export interface ServerOptions {
  config: TrueGateConfig;
  logger?: boolean;
}
