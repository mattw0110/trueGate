import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { MockAgent, setGlobalDispatcher, getGlobalDispatcher, type Dispatcher } from 'undici';
import { OpenAICompatibleProvider } from '../../src/providers/openai/openai-provider.js';

const MOCK_BASE = 'http://mock-openai.local/v1';

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

describe('OpenAICompatibleProvider', () => {
  it('sends correct request shape and returns response', async () => {
    const mockPool = mockAgent.get('http://mock-openai.local');

    const mockResponse = {
      id: 'chatcmpl-test',
      object: 'chat.completion',
      created: 1234567890,
      model: 'gpt-4o-mini',
      choices: [
        {
          index: 0,
          message: { role: 'assistant', content: 'Hello!' },
          finish_reason: 'stop',
        },
      ],
    };

    mockPool
      .intercept({ path: '/v1/chat/completions', method: 'POST' })
      .reply(200, JSON.stringify(mockResponse), {
        headers: { 'content-type': 'application/json' },
      });

    const provider = new OpenAICompatibleProvider({ baseUrl: MOCK_BASE, apiKey: 'sk-test' });
    const result = await provider.complete({
      model: 'gpt-4o-mini',
      messages: [{ role: 'user', content: 'Hi' }],
    });

    expect(result.id).toBe('chatcmpl-test');
    expect(result.choices[0]?.message.content).toBe('Hello!');
  });

  it('works without an API key (local models)', async () => {
    const mockPool = mockAgent.get('http://mock-openai.local');
    mockPool.intercept({ path: '/v1/chat/completions', method: 'POST' }).reply(
      200,
      JSON.stringify({
        id: 'local-1',
        object: 'chat.completion',
        created: 1,
        model: 'llama3',
        choices: [
          { index: 0, message: { role: 'assistant', content: 'hi' }, finish_reason: 'stop' },
        ],
      }),
      { headers: { 'content-type': 'application/json' } },
    );

    const provider = new OpenAICompatibleProvider({ baseUrl: MOCK_BASE });
    const result = await provider.complete({
      model: 'llama3',
      messages: [{ role: 'user', content: 'hi' }],
    });
    expect(result.choices[0]?.message.content).toBe('hi');
  });

  it('sends extra headers (e.g. GitHub Copilot)', async () => {
    const mockPool = mockAgent.get('http://mock-openai.local');
    let capturedHeaders: Record<string, string> = {};

    mockPool.intercept({ path: '/v1/chat/completions', method: 'POST' }).reply(
      200,
      (_opts) => {
        capturedHeaders = (_opts.headers as Record<string, string>) ?? {};
        return JSON.stringify({
          id: 'x',
          object: 'chat.completion',
          created: 1,
          model: 'm',
          choices: [
            { index: 0, message: { role: 'assistant', content: 'ok' }, finish_reason: 'stop' },
          ],
        });
      },
      { headers: { 'content-type': 'application/json' } },
    );

    const provider = new OpenAICompatibleProvider({
      baseUrl: MOCK_BASE,
      apiKey: 'gh-token',
      extraHeaders: { 'copilot-integration-id': 'vscode-chat' },
    });
    await provider.complete({ model: 'gpt-4o', messages: [{ role: 'user', content: 'hi' }] });
    expect(capturedHeaders['copilot-integration-id']).toBe('vscode-chat');
  });

  it('throws on non-2xx response', async () => {
    const mockPool = mockAgent.get('http://mock-openai.local');
    mockPool
      .intercept({ path: '/v1/chat/completions', method: 'POST' })
      .reply(401, JSON.stringify({ error: { message: 'Unauthorized' } }), {
        headers: { 'content-type': 'application/json' },
      });

    const provider = new OpenAICompatibleProvider({ baseUrl: MOCK_BASE, apiKey: 'bad-key' });
    await expect(provider.complete({ model: 'gpt-4o-mini', messages: [] })).rejects.toThrow('401');
  });
});
