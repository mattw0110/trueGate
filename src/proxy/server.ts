import Fastify from 'fastify';
import { makeGovernanceLoaderHook } from './middleware/governance-loader.js';
import { requestCompilerHook } from './middleware/request-compiler.js';
import { registerChatCompletionsRoute } from './routes/chat-completions.js';
import { registerMessagesRoute } from './routes/messages.js';
import { registerResponsesRoute } from './routes/responses.js';
import { registerBlockOverrideRoutes } from './block-override.js';
import type { TrueGateConfig, UpstreamRegistry } from '../types/runtime.js';
import type { FastifyInstance } from 'fastify';

export function buildServer(config: TrueGateConfig, registry?: UpstreamRegistry): FastifyInstance {
  const fastify = Fastify({
    logger:
      config.logLevel !== 'silent'
        ? {
            level: config.logLevel,
          }
        : false,
  });

  fastify.addContentTypeParser('application/json', { parseAs: 'string' }, (_req, body, done) => {
    try {
      done(null, JSON.parse(body as string));
    } catch (err) {
      done(err as Error, undefined);
    }
  });

  // Legacy callers (and existing tests) construct buildServer with just a
  // config. Synthesize a locked-mode registry from config so per-request
  // routing has something to work with.
  const resolved = registry ?? buildLockedRegistrySync(config);

  fastify.addHook('onRequest', makeGovernanceLoaderHook());
  fastify.addHook('preHandler', requestCompilerHook);

  registerBlockOverrideRoutes(fastify);
  registerChatCompletionsRoute(fastify, config, resolved);
  registerMessagesRoute(fastify, config, resolved);
  registerResponsesRoute(fastify, config, resolved);

  return fastify;
}

function buildLockedRegistrySync(config: TrueGateConfig): UpstreamRegistry {
  // buildUpstreamRegistry with noAuto skips network calls so it resolves
  // synchronously enough for our purposes — but it's async-typed. We can't
  // call it sync here, so inline the locked construction.
  const priority = config.providerPriority ?? [
    'openai',
    'anthropic',
    'github-copilot',
    'cliproxy',
    'ollama',
    'lmstudio',
    'custom',
  ];
  // Reuse the async helper for consistency by importing lazily — but since
  // buildServer is sync-typed, do the minimum here.
  const provider = config.provider;
  const baseUrl =
    config.upstreamUrl ??
    (
      {
        openai: 'https://api.openai.com',
        anthropic: 'https://api.anthropic.com',
        ollama: 'http://localhost:11434',
        lmstudio: 'http://localhost:1234',
        'github-copilot': 'https://api.githubcopilot.com',
        cliproxy: 'http://127.0.0.1:8317',
      } as Record<string, string>
    )[provider] ??
    'http://localhost';
  const apiKey =
    provider === 'openai'
      ? config.openAiApiKey
      : provider === 'anthropic'
        ? config.anthropicApiKey
        : provider === 'github-copilot'
          ? (config.githubToken ?? config.upstreamApiKey)
          : config.upstreamApiKey;
  return {
    endpoints: [
      {
        provider,
        baseUrl,
        ...(apiKey !== undefined ? { apiKey } : {}),
        models: [],
        priority: priority.indexOf(provider),
        reachable: true,
      },
    ],
    mode: 'locked',
    priority,
    modelOverrides: config.modelOverrides ?? {},
    ...(config.providerForced ? { forcedProvider: provider } : {}),
  };
}
