import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { MockAgent, setGlobalDispatcher, getGlobalDispatcher, type Dispatcher } from 'undici';
import { AnthropicProvider } from '../../src/providers/anthropic/anthropic-provider.js';

const MOCK_BASE = 'http://mock-anthropic.local';

let mockAgent: MockAgent;
let originalDispatcher: Dispatcher;

beforeEach(() => {
  originalDispatcher = getGlobalDispatcher();
  mockAgent = new MockAgent();
  mockAgent.disableNetConnect();
  setGlobalDispatcher(mockAgent);
});

afterEach(() => {
  setGlobalDispatcher(originalDispatcher);
});

function mockAnthropicResponse(text: string) {
  const pool = mockAgent.get(MOCK_BASE);
  pool.intercept({ path: '/v1/messages', method: 'POST' }).reply(
    200,
    JSON.stringify({
      id: 'msg_test',
      type: 'message',
      role: 'assistant',
      model: 'claude-sonnet-4-5',
      content: [{ type: 'text', text }],
      stop_reason: 'end_turn',
      usage: { input_tokens: 10, output_tokens: 5 },
    }),
    { headers: { 'content-type': 'application/json' } },
  );
}

describe('AnthropicProvider', () => {
  it('translates OpenAI request to Anthropic format', async () => {
    const pool = mockAgent.get(MOCK_BASE);
    let capturedBody: string | undefined;

    pool.intercept({ path: '/v1/messages', method: 'POST' }).reply(
      200,
      (opts) => {
        capturedBody = opts.body as string;
        return JSON.stringify({
          id: 'msg_1',
          type: 'message',
          role: 'assistant',
          model: 'claude-sonnet-4-5',
          content: [{ type: 'text', text: 'Hello' }],
          stop_reason: 'end_turn',
          usage: { input_tokens: 5, output_tokens: 3 },
        });
      },
      { headers: { 'content-type': 'application/json' } },
    );

    const provider = new AnthropicProvider('sk-ant-test', MOCK_BASE);
    await provider.complete({
      model: 'gpt-4o',
      messages: [
        { role: 'system', content: 'Be helpful.' },
        { role: 'user', content: 'Hello' },
      ],
    });

    const body = JSON.parse(capturedBody ?? '{}') as {
      system?: string;
      messages: Array<{ role: string }>;
    };
    expect(body.system).toBe('Be helpful.');
    expect(body.messages.every((m) => m.role !== 'system')).toBe(true);
  });

  it('translates Anthropic response to OpenAI format', async () => {
    mockAnthropicResponse('The answer is 42.');

    const provider = new AnthropicProvider('sk-ant-test', MOCK_BASE);
    const result = await provider.complete({
      model: 'claude-sonnet-4-5',
      messages: [{ role: 'user', content: 'What is the answer?' }],
    });

    expect(result.object).toBe('chat.completion');
    expect(result.choices[0]?.message.role).toBe('assistant');
    expect(result.choices[0]?.message.content).toBe('The answer is 42.');
    expect(result.usage?.prompt_tokens).toBe(10);
    expect(result.usage?.completion_tokens).toBe(5);
  });

  it('maps gpt-4 model names to Claude equivalents', async () => {
    const pool = mockAgent.get(MOCK_BASE);
    let capturedBody: string | undefined;
    pool.intercept({ path: '/v1/messages', method: 'POST' }).reply(
      200,
      (opts) => {
        capturedBody = opts.body as string;
        return JSON.stringify({
          id: 'msg_2',
          type: 'message',
          role: 'assistant',
          model: 'claude-opus-4-5',
          content: [{ type: 'text', text: 'ok' }],
          stop_reason: 'end_turn',
          usage: { input_tokens: 1, output_tokens: 1 },
        });
      },
      { headers: { 'content-type': 'application/json' } },
    );

    const provider = new AnthropicProvider('sk-ant-test', MOCK_BASE);
    await provider.complete({ model: 'gpt-4o', messages: [{ role: 'user', content: 'hi' }] });

    const body = JSON.parse(capturedBody ?? '{}') as { model: string };
    expect(body.model).toBe('claude-opus-4-5');
  });

  it('passes claude model names through unchanged', async () => {
    const pool = mockAgent.get(MOCK_BASE);
    let capturedBody: string | undefined;
    pool.intercept({ path: '/v1/messages', method: 'POST' }).reply(
      200,
      (opts) => {
        capturedBody = opts.body as string;
        return JSON.stringify({
          id: 'msg_3',
          type: 'message',
          role: 'assistant',
          model: 'claude-haiku-4-5',
          content: [{ type: 'text', text: 'ok' }],
          stop_reason: 'end_turn',
          usage: { input_tokens: 1, output_tokens: 1 },
        });
      },
      { headers: { 'content-type': 'application/json' } },
    );

    const provider = new AnthropicProvider('sk-ant-test', MOCK_BASE);
    await provider.complete({
      model: 'claude-haiku-4-5',
      messages: [{ role: 'user', content: 'hi' }],
    });

    const body = JSON.parse(capturedBody ?? '{}') as { model: string };
    expect(body.model).toBe('claude-haiku-4-5');
  });

  it('throws on API error', async () => {
    const pool = mockAgent.get(MOCK_BASE);
    pool
      .intercept({ path: '/v1/messages', method: 'POST' })
      .reply(401, '{"error":"unauthorized"}', {
        headers: { 'content-type': 'application/json' },
      });

    const provider = new AnthropicProvider('bad-key', MOCK_BASE);
    await expect(
      provider.complete({
        model: 'claude-sonnet-4-5',
        messages: [{ role: 'user', content: 'hi' }],
      }),
    ).rejects.toThrow('401');
  });
});
