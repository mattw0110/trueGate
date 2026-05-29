import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { MockAgent, setGlobalDispatcher, getGlobalDispatcher, type Dispatcher } from 'undici';
import { buildServer } from '../../src/proxy/server.js';
import type { TrueGateConfig } from '../../src/types/runtime.js';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const OPENAI_HOST = 'https://api.openai.com';

let tmpDir: string;
let mockAgent: MockAgent;
let originalDispatcher: Dispatcher;

const cfg = (): TrueGateConfig => ({
  port: 3458,
  logLevel: 'silent',
  projectRoot: tmpDir,
  openAiApiKey: 'sk-test',
  provider: 'openai',
});

beforeEach(async () => {
  tmpDir = await mkdtemp(join(tmpdir(), 'tg-reinforce-'));
  originalDispatcher = getGlobalDispatcher();
  mockAgent = new MockAgent();
  mockAgent.disableNetConnect();
  setGlobalDispatcher(mockAgent);
});

afterEach(async () => {
  setGlobalDispatcher(originalDispatcher);
  await rm(tmpDir, { recursive: true, force: true });
});

describe('chat-completions: agent_zero_envelope reinforcement', () => {
  it('injects a CRITICAL OUTPUT FORMAT system message into the upstream request', async () => {
    let capturedBody: string | undefined;
    mockAgent
      .get(OPENAI_HOST)
      .intercept({ path: '/v1/chat/completions', method: 'POST' })
      .reply(
        200,
        (opts) => {
          capturedBody = opts.body as string;
          return JSON.stringify({
            id: 'x',
            object: 'chat.completion',
            created: 1,
            model: 'gpt',
            choices: [
              {
                index: 0,
                message: {
                  role: 'assistant',
                  content: JSON.stringify({
                    thoughts: ['ok'],
                    headline: 'h',
                    tool_name: 'response',
                    tool_args: { text: 'hi' },
                  }),
                },
                finish_reason: 'stop',
              },
            ],
          });
        },
        { headers: { 'content-type': 'application/json' } },
      );

    const server = buildServer(cfg());
    const resp = await server.inject({
      method: 'POST',
      url: '/v1/chat/completions',
      headers: { 'content-type': 'application/json' },
      payload: JSON.stringify({
        model: 'gpt-4o',
        messages: [
          { role: 'system', content: 'You are agent-zero.' },
          { role: 'user', content: 'do thing' },
        ],
        response_format: {
          type: 'json_schema',
          json_schema: { name: 'agent_zero_envelope', strict: true, schema: { type: 'object' } },
        },
      }),
    });

    expect(resp.statusCode).toBe(200);
    expect(capturedBody).toBeDefined();
    const sent = JSON.parse(capturedBody as string) as {
      messages: Array<{ role: string; content: string }>;
    };
    // Reinforcement should land as a system message
    const reinforce = sent.messages.find(
      (m) => m.role === 'system' && m.content.includes('CRITICAL OUTPUT FORMAT'),
    );
    expect(reinforce).toBeDefined();
    // Original agent-zero system message must still be present (possibly merged
    // with governance prose by the request-compiler hook).
    expect(
      sent.messages.some((m) => m.role === 'system' && m.content.includes('You are agent-zero.')),
    ).toBe(true);
    // Reinforcement should come AFTER the original system content (highest recency).
    const origIdx = sent.messages.findIndex((m) => m.content.includes('You are agent-zero.'));
    const reinforceIdx = sent.messages.findIndex((m) =>
      m.content.includes('CRITICAL OUTPUT FORMAT'),
    );
    expect(reinforceIdx).toBeGreaterThan(origIdx);

    // Rule 6 (loop discipline) must be present so the model knows `response` is terminal.
    expect((reinforce as { content: string }).content).toContain('LOOP DISCIPLINE');
    expect((reinforce as { content: string }).content).toContain('response');
    // Rule 8 (no unverified claims) — anti-hallucination guardrail
    expect((reinforce as { content: string }).content).toContain('NO UNVERIFIED CLAIMS');
  });

  it('does NOT inject reinforcement for non-envelope requests', async () => {
    let capturedBody: string | undefined;
    mockAgent
      .get(OPENAI_HOST)
      .intercept({ path: '/v1/chat/completions', method: 'POST' })
      .reply(
        200,
        (opts) => {
          capturedBody = opts.body as string;
          return JSON.stringify({
            id: 'x',
            object: 'chat.completion',
            created: 1,
            model: 'gpt',
            choices: [
              {
                index: 0,
                message: { role: 'assistant', content: 'plain reply' },
                finish_reason: 'stop',
              },
            ],
          });
        },
        { headers: { 'content-type': 'application/json' } },
      );

    const server = buildServer(cfg());
    await server.inject({
      method: 'POST',
      url: '/v1/chat/completions',
      headers: { 'content-type': 'application/json' },
      payload: JSON.stringify({
        model: 'gpt-4o',
        messages: [{ role: 'user', content: 'hello' }],
      }),
    });

    const sent = JSON.parse(capturedBody as string) as {
      messages: Array<{ role: string; content: string }>;
    };
    expect(sent.messages.some((m) => m.content.includes('CRITICAL OUTPUT FORMAT'))).toBe(false);
  });

  it('injects JSON-strict reinforcement for consolidation-style system prompts', async () => {
    let capturedBody: string | undefined;
    mockAgent
      .get(OPENAI_HOST)
      .intercept({ path: '/v1/chat/completions', method: 'POST' })
      .reply(
        200,
        (opts) => {
          capturedBody = opts.body as string;
          return JSON.stringify({
            id: 'x',
            object: 'chat.completion',
            created: 1,
            model: 'gpt',
            choices: [
              {
                index: 0,
                message: { role: 'assistant', content: '{"action":"merge"}' },
                finish_reason: 'stop',
              },
            ],
          });
        },
        { headers: { 'content-type': 'application/json' } },
      );

    const server = buildServer(cfg());
    const resp = await server.inject({
      method: 'POST',
      url: '/v1/chat/completions',
      headers: { 'content-type': 'application/json' },
      payload: JSON.stringify({
        model: 'gpt-4o',
        messages: [
          {
            role: 'system',
            content:
              'Analyse these memories. Your reply must be a single JSON object. Start with `{` and end with `}`. Nothing else.',
          },
          { role: 'user', content: 'memory blob here' },
        ],
      }),
    });

    expect(resp.statusCode).toBe(200);
    expect(capturedBody).toBeDefined();
    const sent = JSON.parse(capturedBody as string) as {
      messages: Array<{ role: string; content: string }>;
    };

    const reinforce = sent.messages.find(
      (m) =>
        m.role === 'system' &&
        m.content.includes('CRITICAL OUTPUT FORMAT — this request demands raw JSON only'),
    );
    expect(reinforce).toBeDefined();
    expect((reinforce as { content: string }).content).toContain(
      'The calling code parses with a strict JSON parser',
    );

    // Reinforcement must come AFTER the original system message (highest recency).
    const origIdx = sent.messages.findIndex((m) => m.content.includes('Analyse these memories'));
    const reinforceIdx = sent.messages.findIndex((m) =>
      m.content.includes('CRITICAL OUTPUT FORMAT — this request demands raw JSON only'),
    );
    expect(reinforceIdx).toBeGreaterThan(origIdx);
  });

  it('does NOT inject JSON-strict reinforcement for plain requests', async () => {
    let capturedBody: string | undefined;
    mockAgent
      .get(OPENAI_HOST)
      .intercept({ path: '/v1/chat/completions', method: 'POST' })
      .reply(
        200,
        (opts) => {
          capturedBody = opts.body as string;
          return JSON.stringify({
            id: 'x',
            object: 'chat.completion',
            created: 1,
            model: 'gpt',
            choices: [
              {
                index: 0,
                message: { role: 'assistant', content: 'hello' },
                finish_reason: 'stop',
              },
            ],
          });
        },
        { headers: { 'content-type': 'application/json' } },
      );

    const server = buildServer(cfg());
    await server.inject({
      method: 'POST',
      url: '/v1/chat/completions',
      headers: { 'content-type': 'application/json' },
      payload: JSON.stringify({
        model: 'gpt-4o',
        messages: [
          { role: 'system', content: 'You are a helpful assistant.' },
          { role: 'user', content: 'What is the capital of France?' },
        ],
      }),
    });

    const sent = JSON.parse(capturedBody as string) as {
      messages: Array<{ role: string; content: string }>;
    };
    expect(
      sent.messages.some((m) =>
        m.content.includes('CRITICAL OUTPUT FORMAT — this request demands raw JSON only'),
      ),
    ).toBe(false);
  });

  it('strips response_format when provider is cliproxy', async () => {
    let capturedBody: string | undefined;
    const CLIPROXY_HOST = 'http://localhost:8317';
    mockAgent
      .get(CLIPROXY_HOST)
      .intercept({ path: '/v1/chat/completions', method: 'POST' })
      .reply(
        200,
        (opts) => {
          capturedBody = opts.body as string;
          return JSON.stringify({
            id: 'x',
            object: 'chat.completion',
            created: 1,
            model: 'claude',
            choices: [
              {
                index: 0,
                message: { role: 'assistant', content: 'plain reply' },
                finish_reason: 'stop',
              },
            ],
          });
        },
        { headers: { 'content-type': 'application/json' } },
      );

    const server = buildServer({
      port: 3459,
      logLevel: 'silent',
      projectRoot: tmpDir,
      provider: 'cliproxy',
      upstreamUrl: CLIPROXY_HOST,
    });

    await server.inject({
      method: 'POST',
      url: '/v1/chat/completions',
      headers: { 'content-type': 'application/json' },
      payload: JSON.stringify({
        model: 'claude-haiku-4-5',
        messages: [{ role: 'user', content: 'hello' }],
        response_format: {
          type: 'json_schema',
          json_schema: { name: 'agent_zero_envelope', strict: true, schema: { type: 'object' } },
        },
      }),
    });

    expect(capturedBody).toBeDefined();
    const sent = JSON.parse(capturedBody as string) as Record<string, unknown>;
    expect(sent.response_format).toBeUndefined();
  });
});
