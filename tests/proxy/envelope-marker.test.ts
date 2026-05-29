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
  tmpDir = await mkdtemp(join(tmpdir(), 'tg-envmarker-'));
  originalDispatcher = getGlobalDispatcher();
  mockAgent = new MockAgent();
  mockAgent.disableNetConnect();
  setGlobalDispatcher(mockAgent);
});

afterEach(async () => {
  setGlobalDispatcher(originalDispatcher);
  await rm(tmpDir, { recursive: true, force: true });
});

/**
 * Simulate the case where the UPSTREAM MODEL (not us) emits an Agent Zero
 * envelope JSON in the content field. The marker must land INSIDE
 * tool_args.text — appending after the JSON's closing brace would break
 * Agent Zero's strict-JSON parsing.
 */
describe('chat-completions: model returns Agent Zero envelope natively', () => {
  it('marker is injected into tool_args.text, JSON stays valid', async () => {
    const modelEnvelope = JSON.stringify({
      thoughts: ['user said hi'],
      headline: 'greeting',
      tool_name: 'response',
      tool_args: { text: 'Hi there!' },
    });

    mockAgent
      .get(OPENAI_HOST)
      .intercept({ path: '/v1/chat/completions', method: 'POST' })
      .reply(
        200,
        JSON.stringify({
          id: 'x',
          object: 'chat.completion',
          created: 1,
          model: 'gpt-4o',
          choices: [
            {
              index: 0,
              message: { role: 'assistant', content: modelEnvelope },
              finish_reason: 'stop',
            },
          ],
        }),
        { headers: { 'content-type': 'application/json' } },
      );

    const server = buildServer(cfg());
    const resp = await server.inject({
      method: 'POST',
      url: '/v1/chat/completions',
      headers: { 'content-type': 'application/json' },
      payload: JSON.stringify({
        model: 'gpt-4o',
        messages: [{ role: 'user', content: 'hi' }],
      }),
    });

    expect(resp.statusCode).toBe(200);
    const outer = resp.json<{ choices: Array<{ message: { content: string } }> }>();
    const contentStr = outer.choices[0]?.message.content ?? '';

    // It must still parse as JSON
    const parsed = JSON.parse(contentStr) as { tool_args: { text: string } };
    expect(parsed.tool_args.text).toContain('Hi there!');
    expect(parsed.tool_args.text).toMatch(/— trueGate( · \S+\/\S+)?\s*$/);
  });

  it('does NOT inject `text` into non-response tool envelopes (would break agent-zero dispatch)', async () => {
    const modelEnvelope = JSON.stringify({
      thoughts: ['t'],
      headline: 'h',
      tool_name: 'code_execution_tool',
      tool_args: { runtime: 'terminal', session: 0, code: 'ls -la' },
    });

    mockAgent
      .get(OPENAI_HOST)
      .intercept({ path: '/v1/chat/completions', method: 'POST' })
      .reply(
        200,
        JSON.stringify({
          id: 'x',
          object: 'chat.completion',
          created: 1,
          model: 'gpt-4o',
          choices: [
            {
              index: 0,
              message: { role: 'assistant', content: modelEnvelope },
              finish_reason: 'stop',
            },
          ],
        }),
        { headers: { 'content-type': 'application/json' } },
      );

    const server = buildServer(cfg());
    const resp = await server.inject({
      method: 'POST',
      url: '/v1/chat/completions',
      headers: { 'content-type': 'application/json' },
      payload: JSON.stringify({
        model: 'gpt-4o',
        messages: [{ role: 'user', content: 'run ls' }],
      }),
    });

    const outer = resp.json<{ choices: Array<{ message: { content: string } }> }>();
    const env = JSON.parse(outer.choices[0]?.message.content ?? '{}') as {
      tool_name: string;
      tool_args: Record<string, unknown>;
    };
    expect(env.tool_name).toBe('code_execution_tool');
    expect(env.tool_args.runtime).toBe('terminal');
    expect(env.tool_args.code).toBe('ls -la');
    // The critical assertion: NO extra `text` field smuggled into tool_args.
    expect(env.tool_args.text).toBeUndefined();
  });

  it('does not double-mark when the model already mimicked the marker', async () => {
    // The upstream model has copied "— trueGate" from prior conversation history.
    const modelEnvelope = JSON.stringify({
      thoughts: ['t'],
      headline: 'h',
      tool_name: 'response',
      tool_args: { text: 'Done with the task.\n\n— trueGate' },
    });

    mockAgent
      .get(OPENAI_HOST)
      .intercept({ path: '/v1/chat/completions', method: 'POST' })
      .reply(
        200,
        JSON.stringify({
          id: 'x',
          object: 'chat.completion',
          created: 1,
          model: 'gpt-4o',
          choices: [
            {
              index: 0,
              message: { role: 'assistant', content: modelEnvelope },
              finish_reason: 'stop',
            },
          ],
        }),
        { headers: { 'content-type': 'application/json' } },
      );

    const server = buildServer(cfg());
    const resp = await server.inject({
      method: 'POST',
      url: '/v1/chat/completions',
      headers: { 'content-type': 'application/json' },
      payload: JSON.stringify({
        model: 'gpt-4o',
        messages: [{ role: 'user', content: 'go' }],
      }),
    });

    const outer = resp.json<{ choices: Array<{ message: { content: string } }> }>();
    const contentStr = outer.choices[0]?.message.content ?? '';
    const parsed = JSON.parse(contentStr) as { tool_args: { text: string } };
    // Exactly one occurrence of the marker.
    const occurrences = (parsed.tool_args.text.match(/— trueGate/g) ?? []).length;
    expect(occurrences).toBe(1);
  });
});
