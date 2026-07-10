import { describe, it, expect } from 'vitest';
import { buildTargetedPolicy } from '../../src/governance/compiler/policy-mode.js';
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

describe('buildTargetedPolicy', () => {
  it('targets schema and validation work', () => {
    const prompt = buildTargetedPolicy('update the zod schema validation for response_format');
    expect(prompt).toContain('Use schema validation at boundaries');
    expect(prompt).toContain('provider/client request shapes');
  });

  it('targets proxy routing and provider compatibility work', () => {
    const prompt = buildTargetedPolicy('fix ollama upstream routing through the proxy');
    expect(prompt).toContain('upstreams are not all fully OpenAI-compatible');
    expect(prompt).toContain('routing explicit and observable');
  });

  it('targets Agent Zero tool-call translation work', () => {
    const prompt = buildTargetedPolicy('repair Agent Zero tool_calls envelope tool_args handling');
    expect(prompt).toContain('Preserve client tool-call contracts');
    expect(prompt).toContain('envelope or tool-call translation');
  });

  it('targets runtime service work', () => {
    const prompt = buildTargetedPolicy('restart systemd service for docker host.docker.internal port 8457');
    expect(prompt).toContain('verify the running process and recent logs');
    expect(prompt).toContain('host/container localhost differences');
  });

  it('targets config and env precedence work', () => {
    const prompt = buildTargetedPolicy('fix config.json env process.env precedence override');
    expect(prompt).toContain('defaults < config file < env < CLI flags');
    expect(prompt).toContain('config boundary');
  });

  it('keeps targeted policy capped', () => {
    const prompt = buildTargetedPolicy(
      'typescript python tests security zod schema proxy upstream ollama agent zero tool_calls systemd docker config env commit review',
    );
    const bulletCount = prompt.split('\n').filter((line) => line.startsWith('- ')).length;
    expect(bulletCount).toBeLessThanOrEqual(8);
    expect(prompt.length).toBeLessThanOrEqual(800 + 'trueGate targeted guidance:\n'.length);
  });
});

describe('injectGovernanceIntoAnthropic — policy modes', () => {
  it('appends targeted governance by default', () => {
    const req: AnthropicNativeRequest = {
      model: 'claude-x',
      max_tokens: 100,
      messages: [{ role: 'user', content: 'hi' }],
      system: 'CLIENT PROMPT',
    };
    const out = injectGovernanceIntoAnthropic(req, ctx);
    expect(out.system).toContain('CLIENT PROMPT\n\ntrueGate targeted guidance:');
    expect(out.system).toContain('Prefer existing local patterns');
    expect(out.system).not.toContain('GOVERNANCE TEXT');
  });

  it('does not append governance when policyMode is off', () => {
    const req: AnthropicNativeRequest = {
      model: 'claude-x',
      max_tokens: 100,
      messages: [{ role: 'user', content: 'hi' }],
      system: 'CLIENT PROMPT',
    };
    const out = injectGovernanceIntoAnthropic(req, ctx, { policyMode: 'off' });
    expect(out.system).toBe('CLIENT PROMPT');
  });

  it('selects targeted TypeScript and verification guidance from source text', () => {
    const req: AnthropicNativeRequest = {
      model: 'claude-x',
      max_tokens: 100,
      messages: [{ role: 'user', content: 'fix TypeScript tests' }],
    };
    const out = injectGovernanceIntoAnthropic(req, ctx, {
      sourceText: 'fix TypeScript tests and run typecheck',
    });
    expect(out.system).toContain('Avoid unreviewed `any`');
    expect(out.system).toContain('Run relevant tests');
  });

  it('appends full governance when policyMode is full', () => {
    const req: AnthropicNativeRequest = {
      model: 'claude-x',
      max_tokens: 100,
      messages: [{ role: 'user', content: 'hi' }],
      system: 'CLIENT PROMPT',
    };
    const out = injectGovernanceIntoAnthropic(req, ctx, { policyMode: 'full' });
    expect(out.system).toBe('CLIENT PROMPT\n\nGOVERNANCE TEXT');
  });

  it('appends light governance when policyMode is light', () => {
    const req: AnthropicNativeRequest = {
      model: 'claude-x',
      max_tokens: 100,
      messages: [{ role: 'user', content: 'hi' }],
      system: 'CLIENT PROMPT',
    };
    const out = injectGovernanceIntoAnthropic(req, ctx, { policyMode: 'light' });
    expect(out.system).toContain('CLIENT PROMPT\n\nFollow the project');
    expect(out.system).not.toContain('GOVERNANCE TEXT');
  });

  it('appends full governance as new block when client system is an array', () => {
    const req: AnthropicNativeRequest = {
      model: 'claude-x',
      max_tokens: 100,
      messages: [{ role: 'user', content: 'hi' }],
      system: [{ type: 'text', text: 'CLIENT', cache_control: { type: 'ephemeral' } }],
    };
    const out = injectGovernanceIntoAnthropic(req, ctx, { policyMode: 'full' });
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
    const out = injectGovernanceIntoAnthropic(req, ctx, {
      stripClientSystem: true,
      policyMode: 'full',
    });
    expect(out.system).toBe('GOVERNANCE TEXT');
  });

  it('replaces an array system with governance only', () => {
    const req: AnthropicNativeRequest = {
      model: 'claude-x',
      max_tokens: 100,
      messages: [{ role: 'user', content: 'hi' }],
      system: [{ type: 'text', text: 'CLIENT', cache_control: { type: 'ephemeral' } }],
    };
    const out = injectGovernanceIntoAnthropic(req, ctx, {
      stripClientSystem: true,
      policyMode: 'full',
    });
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
    const out = injectGovernanceIntoAnthropic(req, emptyCtx, {
      stripClientSystem: true,
      policyMode: 'full',
    });
    expect(out.system).toBeUndefined();
  });
});

describe('injectGovernanceIntoResponses', () => {
  it('appends targeted governance by default', () => {
    const req: ResponsesRequest = {
      model: 'gpt-5',
      input: 'hi',
      instructions: 'CLIENT INSTRUCTIONS',
    };
    const out = injectGovernanceIntoResponses(req, ctx);
    expect(out.instructions).toContain('CLIENT INSTRUCTIONS\n\ntrueGate targeted guidance:');
  });

  it('appends governance to client instructions when policyMode is full', () => {
    const req: ResponsesRequest = {
      model: 'gpt-5',
      input: 'hi',
      instructions: 'CLIENT INSTRUCTIONS',
    };
    const out = injectGovernanceIntoResponses(req, ctx, { policyMode: 'full' });
    expect(out.instructions).toBe('CLIENT INSTRUCTIONS\n\nGOVERNANCE TEXT');
  });

  it('replaces client instructions when stripClientSystem is true', () => {
    const req: ResponsesRequest = {
      model: 'gpt-5',
      input: 'hi',
      instructions: 'CLIENT INSTRUCTIONS',
    };
    const out = injectGovernanceIntoResponses(req, ctx, {
      stripClientSystem: true,
      policyMode: 'full',
    });
    expect(out.instructions).toBe('GOVERNANCE TEXT');
  });
});
