import { describe, it, expect } from 'vitest';
import { injectGovernanceIntoAnthropic } from '../../src/governance/compiler/anthropic-injector.js';
import { injectGovernanceIntoResponses } from '../../src/governance/compiler/responses-injector.js';
import type { CompiledContext } from '../../src/types/governance.js';
import type { AnthropicNativeRequest } from '../../src/types/anthropic.js';
import type { ResponsesRequest } from '../../src/types/responses-api.js';

const ctx: CompiledContext = {
  systemMessage: 'GOVERNANCE TEXT',
  rules: {
    forbiddenDependencies: [],
    forbiddenFrameworks: [],
    dangerousPatterns: [],
    typescriptRules: { noAny: false, requireStrict: false },
  },
  sources: ['truegate'],
  overrides: [],
};

describe('injectGovernanceIntoAnthropic — default (append)', () => {
  it('appends governance when client system is a string', () => {
    const req: AnthropicNativeRequest = {
      model: 'claude-x',
      max_tokens: 100,
      messages: [{ role: 'user', content: 'hi' }],
      system: 'CLIENT PROMPT',
    };
    const out = injectGovernanceIntoAnthropic(req, ctx);
    expect(out.system).toBe('CLIENT PROMPT\n\nGOVERNANCE TEXT');
  });

  it('appends governance as new block when client system is an array', () => {
    const req: AnthropicNativeRequest = {
      model: 'claude-x',
      max_tokens: 100,
      messages: [{ role: 'user', content: 'hi' }],
      system: [{ type: 'text', text: 'CLIENT', cache_control: { type: 'ephemeral' } }],
    };
    const out = injectGovernanceIntoAnthropic(req, ctx);
    expect(Array.isArray(out.system)).toBe(true);
    const arr = out.system as Array<{ text: string }>;
    expect(arr).toHaveLength(2);
    expect(arr[0]?.text).toBe('CLIENT');
    expect(arr[1]?.text).toBe('GOVERNANCE TEXT');
  });
});

describe('injectGovernanceIntoAnthropic — stripClientSystem', () => {
  it('replaces a string system with governance only', () => {
    const req: AnthropicNativeRequest = {
      model: 'claude-x',
      max_tokens: 100,
      messages: [{ role: 'user', content: 'hi' }],
      system: 'CLIENT PROMPT',
    };
    const out = injectGovernanceIntoAnthropic(req, ctx, { stripClientSystem: true });
    expect(out.system).toBe('GOVERNANCE TEXT');
  });

  it('replaces an array system with governance only', () => {
    const req: AnthropicNativeRequest = {
      model: 'claude-x',
      max_tokens: 100,
      messages: [{ role: 'user', content: 'hi' }],
      system: [{ type: 'text', text: 'CLIENT', cache_control: { type: 'ephemeral' } }],
    };
    const out = injectGovernanceIntoAnthropic(req, ctx, { stripClientSystem: true });
    expect(out.system).toBe('GOVERNANCE TEXT');
  });

  it('drops the system field entirely if no governance to inject', () => {
    const emptyCtx: CompiledContext = { ...ctx, systemMessage: '' };
    const req: AnthropicNativeRequest = {
      model: 'claude-x',
      max_tokens: 100,
      messages: [{ role: 'user', content: 'hi' }],
      system: 'CLIENT PROMPT',
    };
    const out = injectGovernanceIntoAnthropic(req, emptyCtx, { stripClientSystem: true });
    expect(out.system).toBeUndefined();
  });
});

describe('injectGovernanceIntoResponses', () => {
  it('appends governance to client instructions by default', () => {
    const req: ResponsesRequest = {
      model: 'gpt-5',
      input: 'hi',
      instructions: 'CLIENT INSTRUCTIONS',
    };
    const out = injectGovernanceIntoResponses(req, ctx);
    expect(out.instructions).toBe('CLIENT INSTRUCTIONS\n\nGOVERNANCE TEXT');
  });

  it('replaces client instructions when stripClientSystem is true', () => {
    const req: ResponsesRequest = {
      model: 'gpt-5',
      input: 'hi',
      instructions: 'CLIENT INSTRUCTIONS',
    };
    const out = injectGovernanceIntoResponses(req, ctx, { stripClientSystem: true });
    expect(out.instructions).toBe('GOVERNANCE TEXT');
  });
});
