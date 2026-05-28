import {
  OpenAICompatibleProvider,
  type OpenAICompatibleOptions,
} from '../openai/openai-provider.js';
import { AnthropicProvider } from '../anthropic/anthropic-provider.js';
import { PROVIDER_BASE_URLS } from '../../config/constants.js';
import type { Provider } from '../../types/providers.js';
import type { TrueGateConfig } from '../../types/runtime.js';

export function createProvider(config: TrueGateConfig): Provider {
  switch (config.provider) {
    case 'anthropic': {
      if (!config.anthropicApiKey) {
        throw new Error('ANTHROPIC_API_KEY is required for the anthropic provider');
      }
      const base = config.upstreamUrl ?? PROVIDER_BASE_URLS.anthropic;
      return new AnthropicProvider(config.anthropicApiKey, base);
    }

    case 'ollama': {
      const base = config.upstreamUrl ?? PROVIDER_BASE_URLS.ollama;
      return new OpenAICompatibleProvider({ baseUrl: base });
    }

    case 'lmstudio': {
      const base = config.upstreamUrl ?? PROVIDER_BASE_URLS.lmstudio;
      return new OpenAICompatibleProvider({ baseUrl: base });
    }

    case 'github-copilot': {
      const token = config.githubToken ?? config.upstreamApiKey;
      if (!token) {
        throw new Error('GITHUB_TOKEN is required for the github-copilot provider');
      }
      return new OpenAICompatibleProvider({
        baseUrl: PROVIDER_BASE_URLS['github-copilot'],
        apiKey: token,
        extraHeaders: {
          'copilot-integration-id': 'vscode-chat',
          'editor-version': 'truegate/0.1.0',
        },
      });
    }

    case 'cliproxy': {
      const base = config.upstreamUrl ?? PROVIDER_BASE_URLS.cliproxy;
      const opts: OpenAICompatibleOptions = { baseUrl: base };
      if (config.upstreamApiKey !== undefined) opts.apiKey = config.upstreamApiKey;
      return new OpenAICompatibleProvider(opts);
    }

    case 'custom': {
      const base = config.upstreamUrl;
      if (!base) {
        throw new Error('TRUEGATE_UPSTREAM_URL is required for the custom provider');
      }
      const customOpts: OpenAICompatibleOptions = { baseUrl: base };
      if (config.upstreamApiKey !== undefined) customOpts.apiKey = config.upstreamApiKey;
      return new OpenAICompatibleProvider(customOpts);
    }

    case 'openai':
    default: {
      if (!config.openAiApiKey) {
        throw new Error('OPENAI_API_KEY is required for the openai provider');
      }
      return new OpenAICompatibleProvider({
        baseUrl: config.upstreamUrl ?? PROVIDER_BASE_URLS.openai,
        apiKey: config.openAiApiKey,
      });
    }
  }
}
