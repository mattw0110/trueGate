import { describe, it, expect } from 'vitest';
import { pickUpstreamForModel } from '../../src/registry/route-model.js';
import type {
  TrueGateConfig,
  UpstreamEndpoint,
  UpstreamRegistry,
} from '../../src/types/runtime.js';

const config: TrueGateConfig = {
  port: 8457,
  logLevel: 'silent',
  projectRoot: '/tmp',
  provider: 'openai',
};

function ep(p: UpstreamEndpoint['provider'], models: string[], reachable = true): UpstreamEndpoint {
  return { provider: p, baseUrl: `http://${p}`, models, priority: 0, reachable };
}

function reg(
  endpoints: UpstreamEndpoint[],
  extra: Partial<UpstreamRegistry> = {},
): UpstreamRegistry {
  return {
    endpoints,
    mode: 'auto',
    priority: ['openai', 'anthropic', 'github-copilot', 'cliproxy', 'ollama', 'lmstudio'],
    modelOverrides: {},
    ...extra,
  };
}

describe('pickUpstreamForModel', () => {
  it('routes exact model match to the right provider', () => {
    const r = reg([
      ep('cliproxy', ['claude-sonnet-4-5', 'gpt-5-codex']),
      ep('ollama', ['llama3.1']),
    ]);
    const out = pickUpstreamForModel('claude-sonnet-4-5', r, config);
    expect(out.endpoint.provider).toBe('cliproxy');
    expect(out.reason).toBe('exact');
  });

  it('breaks ties by priority order', () => {
    const r = reg([ep('openai', ['gpt-4o']), ep('cliproxy', ['gpt-4o'])]);
    expect(pickUpstreamForModel('gpt-4o', r, config).endpoint.provider).toBe('openai');
  });

  it('uses prefix patterns when no exact match', () => {
    const r = reg([ep('anthropic', []), ep('cliproxy', [])]);
    const out = pickUpstreamForModel('claude-opus-9', r, config);
    expect(out.endpoint.provider).toBe('anthropic');
    expect(out.reason).toBe('prefix');
  });

  it('honors modelOverrides ahead of patterns', () => {
    const r = reg([ep('anthropic', []), ep('cliproxy', [])], {
      modelOverrides: { 'claude-sonnet-4-5': 'cliproxy' },
    });
    expect(pickUpstreamForModel('claude-sonnet-4-5', r, config).endpoint.provider).toBe('cliproxy');
  });

  it('forcedProvider wins regardless of model', () => {
    const r = reg([ep('cliproxy', ['claude-sonnet-4-5']), ep('openai', ['gpt-4o'])], {
      forcedProvider: 'cliproxy',
    });
    expect(pickUpstreamForModel('gpt-4o', r, config).endpoint.provider).toBe('cliproxy');
    expect(pickUpstreamForModel('claude-sonnet-4-5', r, config).endpoint.provider).toBe('cliproxy');
  });

  it('falls back to highest-priority reachable upstream for unknown models', () => {
    const r = reg([ep('openai', ['gpt-4o']), ep('cliproxy', ['claude-sonnet-4-5'])]);
    const out = pickUpstreamForModel('mystery-model-7', r, config);
    expect(out.endpoint.provider).toBe('openai');
    expect(out.reason).toBe('fallback');
  });

  it('skips unreachable endpoints', () => {
    const r = reg([ep('openai', ['gpt-4o'], false), ep('cliproxy', ['gpt-4o'], true)]);
    const out = pickUpstreamForModel('gpt-4o', r, config);
    expect(out.endpoint.provider).toBe('cliproxy');
  });
});
