import { DEFAULT_LOG_LEVEL, DEFAULT_PORT } from './constants.js';
import type { TrueGateConfig, ProviderName } from '../types/runtime.js';

const VALID_PROVIDERS: ProviderName[] = [
  'openai',
  'anthropic',
  'ollama',
  'lmstudio',
  'github-copilot',
  'cliproxy',
  'custom',
];

function parseProvider(raw: string | undefined): ProviderName {
  if (raw && (VALID_PROVIDERS as string[]).includes(raw)) return raw as ProviderName;
  return 'openai';
}

export function loadConfig(): TrueGateConfig {
  const port = parseInt(process.env['TRUEGATE_PORT'] ?? String(DEFAULT_PORT), 10);
  const logLevel = process.env['TRUEGATE_LOG_LEVEL'] ?? DEFAULT_LOG_LEVEL;
  const provider = parseProvider(process.env['TRUEGATE_PROVIDER']);

  const config: TrueGateConfig = {
    port: isNaN(port) ? DEFAULT_PORT : port,
    logLevel,
    provider,
  };

  const openAiApiKey = process.env['OPENAI_API_KEY'];
  if (openAiApiKey !== undefined) config.openAiApiKey = openAiApiKey;

  const anthropicApiKey = process.env['ANTHROPIC_API_KEY'];
  if (anthropicApiKey !== undefined) config.anthropicApiKey = anthropicApiKey;

  const githubToken = process.env['GITHUB_TOKEN'];
  if (githubToken !== undefined) config.githubToken = githubToken;

  const upstreamUrl = process.env['TRUEGATE_UPSTREAM_URL'];
  if (upstreamUrl !== undefined) config.upstreamUrl = upstreamUrl;

  const upstreamApiKey = process.env['TRUEGATE_API_KEY'];
  if (upstreamApiKey !== undefined) config.upstreamApiKey = upstreamApiKey;

  return config;
}
