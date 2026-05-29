import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { MockAgent, setGlobalDispatcher, getGlobalDispatcher, type Dispatcher } from 'undici';
import { buildUpstreamRegistry } from '../../src/registry/upstream-registry.js';
import type { TrueGateConfig } from '../../src/types/runtime.js';

let mockAgent: MockAgent;
let original: Dispatcher;

const baseConfig: TrueGateConfig = {
  port: 8457,
  logLevel: 'silent',
  provider: 'openai',
};

beforeEach(() => {
  original = getGlobalDispatcher();
  mockAgent = new MockAgent();
  mockAgent.disableNetConnect();
  setGlobalDispatcher(mockAgent);
});

afterEach(() => {
  setGlobalDispatcher(original);
});

describe('buildUpstreamRegistry', () => {
  it('builds a locked-mode registry when noAuto is true', async () => {
    const reg = await buildUpstreamRegistry(
      { ...baseConfig, providerForced: true, openAiApiKey: 'sk-test' },
      { noAuto: true },
    );
    expect(reg.mode).toBe('locked');
    expect(reg.forcedProvider).toBe('openai');
    expect(reg.endpoints).toHaveLength(1);
    expect(reg.endpoints[0]?.provider).toBe('openai');
  });

  it('probes upstreams in parallel and enumerates models', async () => {
    mockAgent
      .get('http://127.0.0.1:8317')
      .intercept({ path: '/v1/models', method: 'GET' })
      .reply(
        200,
        JSON.stringify({
          data: [{ id: 'claude-sonnet-4-5' }, { id: 'gpt-5-codex' }, { id: 'gemini-2.5-pro' }],
        }),
        { headers: { 'content-type': 'application/json' } },
      );

    mockAgent
      .get('http://localhost:11434')
      .intercept({ path: '/api/tags', method: 'GET' })
      .reply(200, JSON.stringify({ models: [{ name: 'llama3.1' }, { name: 'qwen2.5-coder' }] }), {
        headers: { 'content-type': 'application/json' },
      });

    mockAgent
      .get('http://localhost:1234')
      .intercept({ path: '/v1/models', method: 'GET' })
      .replyWithError(new Error('ECONNREFUSED'));

    const reg = await buildUpstreamRegistry(baseConfig);
    expect(reg.mode).toBe('auto');

    const cliproxy = reg.endpoints.find((e) => e.provider === 'cliproxy');
    expect(cliproxy?.reachable).toBe(true);
    expect(cliproxy?.models).toContain('claude-sonnet-4-5');
    expect(cliproxy?.models).toContain('gpt-5-codex');

    const ollama = reg.endpoints.find((e) => e.provider === 'ollama');
    expect(ollama?.reachable).toBe(true);
    expect(ollama?.models).toContain('llama3.1');

    const lmstudio = reg.endpoints.find((e) => e.provider === 'lmstudio');
    expect(lmstudio?.reachable).toBe(false);
  });

  it('skips providers without required env keys', async () => {
    mockAgent
      .get('http://127.0.0.1:8317')
      .intercept({ path: '/v1/models', method: 'GET' })
      .replyWithError(new Error('nope'));
    mockAgent
      .get('http://localhost:11434')
      .intercept({ path: '/api/tags', method: 'GET' })
      .replyWithError(new Error('nope'));
    mockAgent
      .get('http://localhost:1234')
      .intercept({ path: '/v1/models', method: 'GET' })
      .replyWithError(new Error('nope'));

    const reg = await buildUpstreamRegistry(baseConfig);
    // openai/anthropic/github-copilot must NOT be probed without keys
    expect(reg.endpoints.find((e) => e.provider === 'openai')).toBeUndefined();
    expect(reg.endpoints.find((e) => e.provider === 'anthropic')).toBeUndefined();
    expect(reg.endpoints.find((e) => e.provider === 'github-copilot')).toBeUndefined();
  });

  it('sorts endpoints by priority', async () => {
    mockAgent
      .get('http://127.0.0.1:8317')
      .intercept({ path: '/v1/models', method: 'GET' })
      .reply(200, JSON.stringify({ data: [] }), {
        headers: { 'content-type': 'application/json' },
      });
    mockAgent
      .get('http://localhost:11434')
      .intercept({ path: '/api/tags', method: 'GET' })
      .reply(200, JSON.stringify({ models: [] }), {
        headers: { 'content-type': 'application/json' },
      });
    mockAgent
      .get('http://localhost:1234')
      .intercept({ path: '/v1/models', method: 'GET' })
      .replyWithError(new Error('nope'));

    const reg = await buildUpstreamRegistry(baseConfig);
    const providers = reg.endpoints.map((e) => e.provider);
    // cliproxy has priority 3 (after openai, anthropic, github-copilot); ollama 4; lmstudio 5
    expect(providers.indexOf('cliproxy')).toBeLessThan(providers.indexOf('ollama'));
    expect(providers.indexOf('ollama')).toBeLessThan(providers.indexOf('lmstudio'));
  });
});
