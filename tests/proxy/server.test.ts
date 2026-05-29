import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { MockAgent, setGlobalDispatcher, getGlobalDispatcher, type Dispatcher } from 'undici';
import { buildServer } from '../../src/proxy/server.js';
import type { TrueGateConfig } from '../../src/types/runtime.js';
import { mkdtemp, rm, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const OPENAI_HOST = 'https://api.openai.com';

let tmpDir: string;
let mockAgent: MockAgent;
let originalDispatcher: Dispatcher;

const testConfig = (): TrueGateConfig => ({
  port: 3458,
  logLevel: 'silent',
  projectRoot: tmpDir,
  openAiApiKey: 'sk-test',
  provider: 'openai',
});

beforeEach(async () => {
  tmpDir = await mkdtemp(join(tmpdir(), 'truegate-proxy-test-'));
  originalDispatcher = getGlobalDispatcher();
  mockAgent = new MockAgent();
  mockAgent.disableNetConnect();
  setGlobalDispatcher(mockAgent);
});

afterEach(async () => {
  setGlobalDispatcher(originalDispatcher);
  await rm(tmpDir, { recursive: true, force: true });
});

function mockOpenAIResponse(content: string) {
  const pool = mockAgent.get(OPENAI_HOST);
  pool.intercept({ path: '/v1/chat/completions', method: 'POST' }).reply(
    200,
    JSON.stringify({
      id: 'chatcmpl-test',
      object: 'chat.completion',
      created: 1234567890,
      model: 'gpt-4o-mini',
      choices: [{ index: 0, message: { role: 'assistant', content }, finish_reason: 'stop' }],
    }),
    { headers: { 'content-type': 'application/json' } },
  );
}

describe('proxy server', () => {
  it('passes through a clean response', async () => {
    mockOpenAIResponse('Here is a safe answer.');

    const server = buildServer(testConfig());
    const response = await server.inject({
      method: 'POST',
      url: '/v1/chat/completions',
      headers: { 'content-type': 'application/json' },
      payload: JSON.stringify({
        model: 'gpt-4o-mini',
        messages: [{ role: 'user', content: 'Hello' }],
      }),
    });

    expect(response.statusCode).toBe(200);
    const body = response.json<{ choices: Array<{ message: { content: string } }> }>();
    // Content includes the trueGate marker on its own line
    expect(body.choices[0]?.message.content).toContain('Here is a safe answer.');
    expect(body.choices[0]?.message.content).toMatch(/— trueGate( · \S+\/\S+)?\s*$/);
  });

  it('wraps plain text when Agent Zero JSON envelope is requested', async () => {
    mockOpenAIResponse('Salut');

    const server = buildServer(testConfig());
    const response = await server.inject({
      method: 'POST',
      url: '/v1/chat/completions',
      headers: { 'content-type': 'application/json' },
      payload: JSON.stringify({
        model: 'claude-sonnet-4-5-20250929',
        messages: [{ role: 'user', content: 'say hi in french' }],
        response_format: {
          type: 'json_schema',
          json_schema: {
            name: 'agent_zero_envelope',
            strict: true,
            schema: { type: 'object' },
          },
        },
      }),
    });

    expect(response.statusCode).toBe(200);
    const body = response.json<{ choices: Array<{ message: { content: string } }> }>();
    const content = body.choices[0]?.message.content ?? '';
    const jsonEnd = content.lastIndexOf('}');
    const envelope = JSON.parse(content.slice(0, jsonEnd + 1)) as {
      tool_name: string;
      tool_args: { text: string };
    };

    expect(envelope.tool_name).toBe('response');
    // The model said 'Salut'; trueGate appends its marker inside tool_args.text
    // so the marker survives Agent Zero's JSON envelope wrapping.
    expect(envelope.tool_args.text).toContain('Salut');
    expect(envelope.tool_args.text).toMatch(/— trueGate( · \S+\/\S+)?\s*$/);
  });

  it('streams an Agent Zero envelope when streaming is requested', async () => {
    mockOpenAIResponse('Bonjour!');

    const server = buildServer(testConfig());
    const response = await server.inject({
      method: 'POST',
      url: '/v1/chat/completions',
      headers: { 'content-type': 'application/json' },
      payload: JSON.stringify({
        model: 'claude-sonnet-4-5-20250929',
        stream: true,
        messages: [{ role: 'user', content: 'say hi in french' }],
        response_format: {
          type: 'json_schema',
          json_schema: {
            name: 'agent_zero_envelope',
            strict: true,
            schema: { type: 'object' },
          },
        },
      }),
    });

    expect(response.statusCode).toBe(200);
    expect(response.headers['content-type']).toContain('text/event-stream');
    expect(response.body).toContain('data: ');
    expect(response.body).toContain('"delta":{"role":"assistant","content":"{\\"thoughts\\"');
    expect(response.body).toContain('"tool_name\\":\\"response\\"');
    expect(response.body).toContain('[DONE]');
  });

  it('blocks dangerous response content', async () => {
    // Built-in dangerous-pattern validators fire regardless of project files.
    // We add a CLAUDE.md so there's a governance context active.
    await writeFile(join(tmpDir, 'CLAUDE.md'), '# Project\nNo destructive commands.');

    mockOpenAIResponse('Sure! Run: rm -rf / to clean up.');

    const server = buildServer(testConfig());
    const response = await server.inject({
      method: 'POST',
      url: '/v1/chat/completions',
      headers: { 'content-type': 'application/json' },
      payload: JSON.stringify({
        model: 'gpt-4o-mini',
        messages: [{ role: 'user', content: 'delete everything' }],
      }),
    });

    expect(response.statusCode).toBe(200);
    const body = response.json<{ choices: Array<{ message: { content: string } }> }>();
    expect(body.choices[0]?.message.content).toContain('Governance Block');
  });

  it('returns 404 for unknown routes', async () => {
    const server = buildServer(testConfig());
    const response = await server.inject({ method: 'GET', url: '/unknown' });
    expect(response.statusCode).toBe(404);
  });
});
