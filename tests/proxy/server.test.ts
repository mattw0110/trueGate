import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { MockAgent, setGlobalDispatcher, getGlobalDispatcher, type Dispatcher } from 'undici';
import { buildServer } from '../../src/proxy/server.js';
import { clearBlockOverrides } from '../../src/proxy/block-override.js';
import { flushGovernanceLog } from '../../src/governance/events/logger.js';
import type { TrueGateConfig } from '../../src/types/runtime.js';
import { mkdtemp, rm, mkdir, writeFile, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

const OPENAI_HOST = 'https://api.openai.com';

let tmpDir: string;
let mockAgent: MockAgent;
let originalDispatcher: Dispatcher;
let originalStateDir: string | undefined;

const testConfig = (): TrueGateConfig => ({
  port: 3458,
  logLevel: 'silent',
  openAiApiKey: 'sk-test',
  provider: 'openai',
});

beforeEach(async () => {
  tmpDir = await mkdtemp(join(tmpdir(), 'truegate-proxy-test-'));
  originalStateDir = process.env['TRUEGATE_STATE_DIR'];
  process.env['TRUEGATE_STATE_DIR'] = join(tmpDir, '.state');
  clearBlockOverrides();
  originalDispatcher = getGlobalDispatcher();
  mockAgent = new MockAgent();
  mockAgent.disableNetConnect();
  setGlobalDispatcher(mockAgent);
});

afterEach(async () => {
  setGlobalDispatcher(originalDispatcher);
  await flushGovernanceLog();
  if (originalStateDir === undefined) delete process.env['TRUEGATE_STATE_DIR'];
  else process.env['TRUEGATE_STATE_DIR'] = originalStateDir;
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

function headerValue(
  headers: Record<string, string | string[]> | Array<string> | undefined,
  name: string,
): string | undefined {
  if (!headers) return undefined;
  if (Array.isArray(headers)) {
    const idx = headers.findIndex((h) => h.toLowerCase() === name.toLowerCase());
    return idx >= 0 ? headers[idx + 1] : undefined;
  }
  const value = headers[name] ?? headers[name.toLowerCase()];
  return Array.isArray(value) ? value[0] : value;
}

async function readGovernanceEvents(minCount = 1): Promise<Array<Record<string, unknown>>> {
  const path = join(process.env['TRUEGATE_STATE_DIR'] ?? '', 'logs', 'governance.ndjson');
  for (let i = 0; i < 20; i += 1) {
    try {
      const raw = await readFile(path, 'utf-8');
      const events = raw
        .trim()
        .split('\n')
        .filter(Boolean)
        .map((line) => JSON.parse(line) as Record<string, unknown>);
      if (events.length >= minCount) return events;
    } catch {
      /* wait for async log write */
    }
    await delay(25);
  }
  return [];
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
    expect(body.choices[0]?.message.content).toMatch(
      /— trueGate( · \S+\/\S+)?(\nGovernance: .+)?\s*$/,
    );
    // x-truegate-upstream header reflects the routed upstream.
    expect(response.headers['x-truegate-upstream']).toMatch(/^openai\/.+/);
  });

  it('wraps plain text when Agent Zero JSON envelope is requested', async () => {
    mockOpenAIResponse('Salut');

    const server = buildServer(testConfig());
    const response = await server.inject({
      method: 'POST',
      url: '/v1/chat/completions',
      headers: { 'content-type': 'application/json' },
      payload: JSON.stringify({
        model: 'claude-sonnet-4-6-20250929',
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
    expect(envelope.tool_args.text).toMatch(/— trueGate( · \S+\/\S+)?(\nGovernance: .+)?\s*$/);
  });

  it('streams an Agent Zero envelope when streaming is requested', async () => {
    mockOpenAIResponse('Bonjour!');

    const server = buildServer(testConfig());
    const response = await server.inject({
      method: 'POST',
      url: '/v1/chat/completions',
      headers: { 'content-type': 'application/json' },
      payload: JSON.stringify({
        model: 'claude-sonnet-4-6-20250929',
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

  it('offers a one-shot override link for intended blocked behavior', async () => {
    await writeFile(join(tmpDir, 'CLAUDE.md'), '# Project\nNo destructive commands.');

    const server = buildServer(testConfig());

    mockOpenAIResponse('Sure! Run: rm -rf / to clean up.');
    const blocked = await server.inject({
      method: 'POST',
      url: '/v1/chat/completions',
      headers: { 'content-type': 'application/json', host: 'host.docker.internal:3458' },
      payload: JSON.stringify({
        model: 'gpt-4o-mini',
        messages: [{ role: 'user', content: 'delete everything' }],
      }),
    });

    const blockedBody = blocked.json<{ choices: Array<{ message: { content: string } }> }>();
    const blockedText = blockedBody.choices[0]?.message.content ?? '';
    expect(blockedText).toContain('Governance Block');
    expect(blockedText).toContain('[Allow once]');
    const overrideHref = /\[Allow once\]\((http:\/\/localhost:3458\/truegate\/override\/[^)]+)\)/.exec(
      blockedText,
    )?.[1];
    expect(overrideHref).toBeDefined();

    const armed = await server.inject({
      method: 'GET',
      url: new URL(overrideHref as string).pathname,
    });
    expect(armed.statusCode).toBe(200);
    expect(armed.body).toContain('override armed');

    mockOpenAIResponse('Sure! Run: rm -rf / to clean up.');
    const overridden = await server.inject({
      method: 'POST',
      url: '/v1/chat/completions',
      headers: { 'content-type': 'application/json', host: 'host.docker.internal:3458' },
      payload: JSON.stringify({
        model: 'gpt-4o-mini',
        messages: [{ role: 'user', content: 'delete everything' }],
      }),
    });
    const overriddenBody = overridden.json<{ choices: Array<{ message: { content: string } }> }>();
    const overriddenText = overriddenBody.choices[0]?.message.content ?? '';
    expect(overriddenText).toContain('Sure! Run: rm -rf / to clean up.');
    expect(overriddenText).toContain('Operator override used once');

    mockOpenAIResponse('Sure! Run: rm -rf / to clean up.');
    const blockedAgain = await server.inject({
      method: 'POST',
      url: '/v1/chat/completions',
      headers: { 'content-type': 'application/json', host: 'host.docker.internal:3458' },
      payload: JSON.stringify({
        model: 'gpt-4o-mini',
        messages: [{ role: 'user', content: 'delete everything' }],
      }),
    });
    const blockedAgainBody = blockedAgain.json<{ choices: Array<{ message: { content: string } }> }>();
    expect(blockedAgainBody.choices[0]?.message.content).toContain('Governance Block');

    const events = await readGovernanceEvents(3);
    expect(events.map((event) => event['decision'])).toEqual(['block', 'override_allowed', 'block']);
    expect(events[0]).toMatchObject({
      event: 'governance_decision',
      route: '/v1/chat/completions',
      provider: 'openai',
      model: 'gpt-4o-mini',
      client: 'plain',
      overrideOffered: true,
      governance: {
        bundleSource: 'data',
      },
    });
    expect((events[0]?.['governance'] as { governanceHash?: string }).governanceHash).toHaveLength(
      10,
    );
    expect(events[1]).toMatchObject({
      decision: 'override_allowed',
      overrideUsed: true,
    });
    expect(JSON.stringify(events)).not.toContain('Sure! Run: rm -rf / to clean up.');
  });

  it('keeps concurrent Agent Zero requests isolated', async () => {
    const captured: Array<{
      authorization: string | undefined;
      model: string | undefined;
      userText: string | undefined;
      advertisedTools: string[];
    }> = [];

    const pool = mockAgent.get(OPENAI_HOST);
    for (let i = 0; i < 3; i += 1) {
      pool
        .intercept({ path: '/v1/chat/completions', method: 'POST' })
        .reply(
          200,
          (opts) => {
            const body = JSON.parse(String(opts.body)) as {
              model?: string;
              messages?: Array<{ role: string; content: string }>;
            };
            const userText = body.messages?.find((m) => m.role === 'user')?.content;
            const advertisedTools =
              body.messages
                ?.filter((m) => m.role === 'system')
                .flatMap((m) => [...m.content.matchAll(/^###\s+([^\s:]+)/gm)].map((match) => match[1])) ??
              [];

            captured.push({
              authorization: headerValue(
                opts.headers as Record<string, string | string[]> | Array<string> | undefined,
                'authorization',
              ),
              model: body.model,
              userText,
              advertisedTools,
            });

            return JSON.stringify({
              id: `chatcmpl-${userText}`,
              object: 'chat.completion',
              created: 1234567890,
              model: body.model,
              choices: [
                {
                  index: 0,
                  message: { role: 'assistant', content: `reply for ${userText}` },
                  finish_reason: 'stop',
                },
              ],
            });
          },
          { headers: { 'content-type': 'application/json' } },
        );
    }

    const server = buildServer(testConfig());
    const requests = ['agent-a', 'agent-b', 'agent-c'].map((agent, idx) =>
      server.inject({
        method: 'POST',
        url: '/v1/chat/completions',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer token-${agent}`,
        },
        payload: JSON.stringify({
          model: `gpt-4o-${idx}`,
          messages: [
            { role: 'system', content: `### tool_${agent}` },
            { role: 'user', content: agent },
          ],
          response_format: {
            type: 'json_schema',
            json_schema: {
              name: 'agent_zero_envelope',
              strict: true,
              schema: { type: 'object' },
            },
          },
        }),
      }),
    );

    const responses = await Promise.all(requests);

    expect(responses.map((r) => r.statusCode)).toEqual([200, 200, 200]);
    for (const [idx, response] of responses.entries()) {
      const agent = ['agent-a', 'agent-b', 'agent-c'][idx];
      const body = response.json<{ choices: Array<{ message: { content: string } }> }>();
      const content = body.choices[0]?.message.content ?? '';
      const envelope = JSON.parse(content.slice(0, content.lastIndexOf('}') + 1)) as {
        tool_name: string;
        tool_args: { text: string };
      };

      expect(envelope.tool_name).toBe('response');
      expect(envelope.tool_args.text).toContain(`reply for ${agent}`);
      expect(response.headers['x-truegate-upstream']).toBe(`openai/gpt-4o-${idx}`);
    }

    expect(captured).toHaveLength(3);
    for (const agent of ['agent-a', 'agent-b', 'agent-c']) {
      const entry = captured.find((item) => item.userText === agent);
      expect(entry).toMatchObject({
        authorization: `Bearer token-${agent}`,
        userText: agent,
      });
      expect(entry?.advertisedTools).toContain(`tool_${agent}`);
      expect(entry?.advertisedTools).not.toContain(
        `tool_${agent === 'agent-a' ? 'agent-b' : 'agent-a'}`,
      );
    }
  });

  it('returns 404 for unknown routes', async () => {
    const server = buildServer(testConfig());
    const response = await server.inject({ method: 'GET', url: '/unknown' });
    expect(response.statusCode).toBe(404);
  });
});
