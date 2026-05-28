export const TRUEGATE_DIR = '.truegate';
export const GOVERNANCE_FILE = 'governance.md';
export const RULES_FILE = 'rules.yaml';
export const DEFAULT_PORT = 8457;
export const DEFAULT_LOG_LEVEL = 'info';
export const GOVERNANCE_CACHE_TTL_MS = 5_000;
export const WARNING_PREFIX = '⚠ Governance Warning';
export const BLOCK_PREFIX = '🚫 Governance Block';
export const DEFAULT_RESPONSE_MARKER = '— trueGate';

// Host-only base URLs. The provider/route classes append the `/v1/<endpoint>`
// path themselves, so users can set TRUEGATE_UPSTREAM_URL with or without /v1.
export const PROVIDER_BASE_URLS = {
  openai: 'https://api.openai.com',
  anthropic: 'https://api.anthropic.com',
  ollama: 'http://localhost:11434',
  lmstudio: 'http://localhost:1234',
  'github-copilot': 'https://api.githubcopilot.com',
  cliproxy: 'http://127.0.0.1:8317',
} as const;

export const ANTHROPIC_VERSION = '2023-06-01';
export const ANTHROPIC_DEFAULT_MODEL = 'claude-sonnet-4-5';
export const OPENAI_BASE_URL = PROVIDER_BASE_URLS.openai;
