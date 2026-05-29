import type {
  ProviderName,
  TrueGateConfig,
  UpstreamEndpoint,
  UpstreamRegistry,
} from '../types/runtime.js';
import { candidatesForModel } from './model-patterns.js';

export interface RouteResolution {
  endpoint: UpstreamEndpoint;
  /** How the routing decision was reached — purely for logging / diagnostics. */
  reason: 'forced' | 'override' | 'exact' | 'prefix' | 'substring' | 'fallback';
}

function findByProvider(
  registry: UpstreamRegistry,
  provider: ProviderName,
): UpstreamEndpoint | undefined {
  return registry.endpoints.find((e) => e.provider === provider);
}

function reachableByProvider(
  registry: UpstreamRegistry,
  provider: ProviderName,
): UpstreamEndpoint | undefined {
  return registry.endpoints.find((e) => e.provider === provider && e.reachable);
}

function pickReachableHighestPriority(registry: UpstreamRegistry): UpstreamEndpoint | undefined {
  for (const ep of registry.endpoints) {
    if (ep.reachable) return ep;
  }
  return registry.endpoints[0];
}

/**
 * Resolve the upstream that should serve a request for `model`.
 *
 * 1. `--provider X` (forcedProvider on the registry) wins unconditionally.
 * 2. Operator-supplied `modelOverrides[model]` second.
 * 3. Exact model name match across reachable upstreams (priority breaks ties).
 * 4. Prefix-pattern hints (claude-*, gpt-*, …) restricted to reachable upstreams.
 * 5. Substring scan across model lists.
 * 6. Fall back to highest-priority reachable upstream (let it decide).
 */
export function pickUpstreamForModel(
  model: string,
  registry: UpstreamRegistry,
  _config: TrueGateConfig,
): RouteResolution {
  if (registry.forcedProvider) {
    const ep = findByProvider(registry, registry.forcedProvider);
    if (ep) return { endpoint: ep, reason: 'forced' };
  }

  const override = registry.modelOverrides[model];
  if (override) {
    const ep = reachableByProvider(registry, override);
    if (ep) return { endpoint: ep, reason: 'override' };
  }

  // 3. Exact model match
  const exact = registry.endpoints.filter((e) => e.reachable && e.models.includes(model));
  if (exact.length > 0) {
    return { endpoint: exact[0]!, reason: 'exact' };
  }

  // 4. Prefix-pattern hint
  const candidates = candidatesForModel(model);
  for (const cand of candidates) {
    const ep = reachableByProvider(registry, cand);
    if (ep) return { endpoint: ep, reason: 'prefix' };
  }

  // 5. Substring scan
  const lower = model.toLowerCase();
  for (const ep of registry.endpoints) {
    if (!ep.reachable) continue;
    if (ep.models.some((m) => m.toLowerCase().includes(lower))) {
      return { endpoint: ep, reason: 'substring' };
    }
  }

  // 6. Fallback
  const fb = pickReachableHighestPriority(registry);
  if (!fb) {
    throw new Error('No upstreams in registry — cannot route request');
  }
  return { endpoint: fb, reason: 'fallback' };
}
