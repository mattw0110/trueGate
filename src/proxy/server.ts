import Fastify from 'fastify';
import { makeGovernanceLoaderHook } from './middleware/governance-loader.js';
import { requestCompilerHook } from './middleware/request-compiler.js';
// makeResponseValidatorHook is unused now — every route applies governance + marker in-route.
// Keep the file around in case a future route needs the hook pattern again.
import { registerChatCompletionsRoute } from './routes/chat-completions.js';
import { registerMessagesRoute } from './routes/messages.js';
import { registerResponsesRoute } from './routes/responses.js';
import type { TrueGateConfig } from '../types/runtime.js';
import type { FastifyInstance } from 'fastify';

export function buildServer(config: TrueGateConfig): FastifyInstance {
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

  fastify.addHook('onRequest', makeGovernanceLoaderHook(config.projectRoot));
  fastify.addHook('preHandler', requestCompilerHook);
  // Governance validation + marker injection now lives inside each route handler.

  registerChatCompletionsRoute(fastify, config);
  registerMessagesRoute(fastify, config);
  registerResponsesRoute(fastify, config);

  return fastify;
}
