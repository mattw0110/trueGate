import type { FastifyRequest, FastifyReply } from 'fastify';
import { mergeContext } from '../../governance/compiler/merge-context.js';
import { buildRuntimeContext } from '../../governance/compiler/build-runtime-context.js';
import { GOVERNANCE_CACHE_TTL_MS } from '../../config/constants.js';
import type { CompiledContext } from '../../types/governance.js';

interface CacheEntry {
  context: CompiledContext;
  expiresAt: number;
}

const cache = new Map<string, CacheEntry>();

export async function loadGovernanceContext(projectRoot: string): Promise<CompiledContext> {
  const now = Date.now();
  const cached = cache.get(projectRoot);
  if (cached && cached.expiresAt > now) {
    return cached.context;
  }

  const files = await mergeContext(projectRoot);
  const context = buildRuntimeContext(files);

  cache.set(projectRoot, { context, expiresAt: now + GOVERNANCE_CACHE_TTL_MS });
  return context;
}

export function makeGovernanceLoaderHook(projectRoot: string) {
  return async function governanceLoaderHook(
    request: FastifyRequest,
    _reply: FastifyReply,
  ): Promise<void> {
    request.governanceContext = await loadGovernanceContext(projectRoot);
  };
}
