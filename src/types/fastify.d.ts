import type { CompiledContext } from './governance.js';

declare module 'fastify' {
  interface FastifyRequest {
    governanceContext?: CompiledContext;
  }
}
