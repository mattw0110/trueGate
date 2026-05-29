import type { FastifyRequest, FastifyReply } from 'fastify';
import { mergeContext } from '../../governance/compiler/merge-context.js';
import { buildRuntimeContext } from '../../governance/compiler/build-runtime-context.js';
import { GOVERNANCE_CACHE_TTL_MS } from '../../config/constants.js';
import type { CompiledContext } from '../../types/governance.js';

interface CacheEntry {
  context: CompiledContext;
  expiresAt: number;
}

let cached: CacheEntry | null = null;

export async function loadGovernanceContext(): Promise<CompiledContext> {
  const now = Date.now();
  if (cached && cached.expiresAt > now) return cached.context;

  const files = await mergeContext();
  const context = buildRuntimeContext(files);
  cached = { context, expiresAt: now + GOVERNANCE_CACHE_TTL_MS };
  return context;
}

export function makeGovernanceLoaderHook() {
  return async function governanceLoaderHook(
    request: FastifyRequest,
    _reply: FastifyReply,
  ): Promise<void> {
    request.governanceContext = await loadGovernanceContext();
  };
}
