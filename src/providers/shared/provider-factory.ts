import {
  OpenAICompatibleProvider,
  type OpenAICompatibleOptions,
} from '../openai/openai-provider.js';
import { AnthropicProvider } from '../anthropic/anthropic-provider.js';
import { PROVIDER_BASE_URLS } from '../../config/constants.js';
import type { Provider } from '../../types/providers.js';
import type {
  ProviderName,
  TrueGateConfig,
  UpstreamEndpoint,
  UpstreamRegistry,
} from '../../types/runtime.js';

/**
 * Build a Provider instance for a single resolved upstream endpoint. This is
 * the per-request building block — the route handler picks an endpoint via
 * the registry, then asks the factory for a matching client.
 */
export function createProviderForEndpoint(
  endpoint: UpstreamEndpoint,
  config: TrueGateConfig,
): Provider {
  switch (endpoint.provider) {
    case 'anthropic': {
      const key = endpoint.apiKey ?? config.anthropicApiKey;
      if (!key) {
        throw new Error('ANTHROPIC_API_KEY is required for the anthropic provider');
      }
      return new AnthropicProvider(key, endpoint.baseUrl);
    }

    case 'github-copilot': {
      const token = endpoint.apiKey ?? config.githubToken ?? config.upstreamApiKey;
      if (!token) {
        throw new Error('GITHUB_TOKEN is required for the github-copilot provider');
      }
      return new OpenAICompatibleProvider({
        baseUrl: endpoint.baseUrl,
        apiKey: token,
        extraHeaders: {
          'copilot-integration-id': 'vscode-chat',
          'editor-version': 'truegate/0.1.0',
        },
      });
    }

    case 'openai': {
      const key = endpoint.apiKey ?? config.openAiApiKey;
      if (!key) {
        throw new Error('OPENAI_API_KEY is required for the openai provider');
      }
      return new OpenAICompatibleProvider({
        baseUrl: endpoint.baseUrl,
        apiKey: key,
      });
    }

    case 'cliproxy':
    case 'ollama':
    case 'lmstudio':
    case 'custom':
    default: {
      const opts: OpenAICompatibleOptions = { baseUrl: endpoint.baseUrl };
      if (endpoint.apiKey !== undefined) opts.apiKey = endpoint.apiKey;
      else if (config.upstreamApiKey !== undefined) opts.apiKey = config.upstreamApiKey;
      return new OpenAICompatibleProvider(opts);
    }
  }
}

/**
 * Build one Provider per reachable upstream in the registry. Useful when a
 * caller wants to pre-construct clients at startup rather than per-request.
 */
export function createProviderRegistry(
  config: TrueGateConfig,
  registry: UpstreamRegistry,
): Map<ProviderName, Provider> {
  const map = new Map<ProviderName, Provider>();
  for (const ep of registry.endpoints) {
    if (!ep.reachable) continue;
    try {
      map.set(ep.provider, createProviderForEndpoint(ep, config));
    } catch {
      /* missing keys for an endpoint — skip rather than blowing up startup */
    }
  }
  return map;
}

/**
 * Legacy single-provider factory. Kept for back-compat with callers that
 * haven't been migrated to the registry yet.
 */
export function createProvider(config: TrueGateConfig): Provider {
  const provider = config.provider;
  const baseUrl =
    config.upstreamUrl ??
    PROVIDER_BASE_URLS[provider as keyof typeof PROVIDER_BASE_URLS] ??
    'http://localhost';
  const apiKey =
    provider === 'openai'
      ? config.openAiApiKey
      : provider === 'anthropic'
        ? config.anthropicApiKey
        : provider === 'github-copilot'
          ? (config.githubToken ?? config.upstreamApiKey)
          : config.upstreamApiKey;
  const endpoint: UpstreamEndpoint = {
    provider,
    baseUrl,
    models: [],
    priority: 0,
    reachable: true,
  };
  if (apiKey !== undefined) endpoint.apiKey = apiKey;
  return createProviderForEndpoint(endpoint, config);
}
