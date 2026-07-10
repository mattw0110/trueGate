import type { CompiledContext } from './governance.js';
import type { TrueGateConfig } from './runtime.js';

declare module 'fastify' {
  interface FastifyInstance {
    truegateConfig: TrueGateConfig;
  }

  interface FastifyRequest {
    governanceContext?: CompiledContext;
  }
}
