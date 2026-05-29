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
  tmpDir = await mkdtemp(join(tmpdir(), 'tg-xml-'));
  originalDispatcher = getGlobalDispatcher();
  mockAgent = new MockAgent();
  mockAgent.disableNetConnect();
  setGlobalDispatcher(mockAgent);
});

afterEach(async () => {
  setGlobalDispatcher(originalDispatcher);
  await rm(tmpDir, { recursive: true, force: true });
});

function mockUpstream(content: string) {
  mockAgent
    .get(OPENAI_HOST)
    .intercept({ path: '/v1/chat/completions', method: 'POST' })
    .reply(
      200,
      JSON.stringify({
        id: 'x',
        object: 'chat.completion',
        created: 1,
        model: 'gpt',
        choices: [{ index: 0, message: { role: 'assistant', content }, finish_reason: 'stop' }],
      }),
      { headers: { 'content-type': 'application/json' } },
    );
}

async function callEnvelope(server: ReturnType<typeof buildServer>) {
  return server.inject({
    method: 'POST',
    url: '/v1/chat/completions',
    headers: { 'content-type': 'application/json' },
    payload: JSON.stringify({
      model: 'gpt-4o',
      messages: [{ role: 'user', content: 'do thing' }],
      response_format: {
        type: 'json_schema',
        json_schema: { name: 'agent_zero_envelope', strict: true, schema: { type: 'object' } },
      },
    }),
  });
}

describe('chat-completions: Claude Code XML → Agent Zero envelope', () => {
  it('translates <function_calls><invoke> into tool_name + tool_args', async () => {
    mockUpstream(
      `I need to read the file.\n<function_calls>\n<invoke name="text_editor">\n<parameter name="command">read</parameter>\n<parameter name="path">/tmp/foo.py</parameter>\n<parameter name="start">1</parameter>\n<parameter name="end">150</parameter>\n</invoke>\n</function_calls>`,
    );

    const server = buildServer(cfg());
    const resp = await callEnvelope(server);
    expect(resp.statusCode).toBe(200);

    const body = resp.json<{ choices: Array<{ message: { content: string } }> }>();
    const envelope = JSON.parse(body.choices[0]?.message.content ?? '{}') as {
      tool_name: string;
      tool_args: Record<string, unknown>;
    };

    expect(envelope.tool_name).toBe('text_editor');
    expect(envelope.tool_args.command).toBe('read');
    expect(envelope.tool_args.path).toBe('/tmp/foo.py');
    expect(envelope.tool_args.start).toBe(1);
    expect(envelope.tool_args.end).toBe(150);
  });

  it('preserves model reasoning prose as thoughts[0]', async () => {
    mockUpstream(
      `User wants to read foo.py. I'll use text_editor.\n<function_calls>\n<invoke name="text_editor">\n<parameter name="command">read</parameter>\n<parameter name="path">/tmp/foo.py</parameter>\n</invoke>\n</function_calls>`,
    );

    const server = buildServer(cfg());
    const resp = await callEnvelope(server);
    const envelope = JSON.parse(
      resp.json<{ choices: Array<{ message: { content: string } }> }>().choices[0]?.message
        .content ?? '{}',
    ) as { thoughts: string[] };
    expect(envelope.thoughts[0]).toContain('text_editor');
  });

  it('coerces boolean and JSON parameter values (on a pass-through tool)', async () => {
    // knowledge_tool is already an agent-zero name and passes through with args intact
    mockUpstream(
      `<function_calls>\n<invoke name="knowledge_tool">\n<parameter name="question">foo</parameter>\n<parameter name="case_sensitive">true</parameter>\n<parameter name="filters">{"ext":"py"}</parameter>\n</invoke>\n</function_calls>`,
    );

    const server = buildServer(cfg());
    const resp = await callEnvelope(server);
    const envelope = JSON.parse(
      resp.json<{ choices: Array<{ message: { content: string } }> }>().choices[0]?.message
        .content ?? '{}',
    ) as { tool_args: Record<string, unknown> };
    expect(envelope.tool_args.case_sensitive).toBe(true);
    expect(envelope.tool_args.filters).toEqual({ ext: 'py' });
  });

  it('maps Claude Code Read to agent-zero text_editor view', async () => {
    mockUpstream(
      `<function_calls>\n<invoke name="Read">\n<parameter name="file_path">/tmp/foo.py</parameter>\n<parameter name="offset">1</parameter>\n<parameter name="limit">50</parameter>\n</invoke>\n</function_calls>`,
    );

    const server = buildServer(cfg());
    const resp = await callEnvelope(server);
    const envelope = JSON.parse(
      resp.json<{ choices: Array<{ message: { content: string } }> }>().choices[0]?.message
        .content ?? '{}',
    ) as { tool_name: string; tool_args: Record<string, unknown> };

    expect(envelope.tool_name).toBe('text_editor');
    expect(envelope.tool_args.command).toBe('view');
    expect(envelope.tool_args.path).toBe('/tmp/foo.py');
    expect(envelope.tool_args.view_range).toEqual([1, 51]);
  });

  it('maps Claude Code Bash to agent-zero code_execution_tool terminal', async () => {
    mockUpstream(
      `<function_calls>\n<invoke name="Bash">\n<parameter name="command">ls -la /tmp</parameter>\n</invoke>\n</function_calls>`,
    );

    const server = buildServer(cfg());
    const resp = await callEnvelope(server);
    const envelope = JSON.parse(
      resp.json<{ choices: Array<{ message: { content: string } }> }>().choices[0]?.message
        .content ?? '{}',
    ) as { tool_name: string; tool_args: Record<string, unknown> };

    expect(envelope.tool_name).toBe('code_execution_tool');
    expect(envelope.tool_args.runtime).toBe('terminal');
    expect(envelope.tool_args.code).toBe('ls -la /tmp');
  });

  it('maps Claude Code Edit to agent-zero text_editor str_replace', async () => {
    mockUpstream(
      `<function_calls>\n<invoke name="Edit">\n<parameter name="file_path">/tmp/x.py</parameter>\n<parameter name="old_string">foo</parameter>\n<parameter name="new_string">bar</parameter>\n</invoke>\n</function_calls>`,
    );

    const server = buildServer(cfg());
    const resp = await callEnvelope(server);
    const envelope = JSON.parse(
      resp.json<{ choices: Array<{ message: { content: string } }> }>().choices[0]?.message
        .content ?? '{}',
    ) as { tool_name: string; tool_args: Record<string, unknown> };

    expect(envelope.tool_name).toBe('text_editor');
    expect(envelope.tool_args.command).toBe('str_replace');
    expect(envelope.tool_args.path).toBe('/tmp/x.py');
    expect(envelope.tool_args.old_str).toBe('foo');
    expect(envelope.tool_args.new_str).toBe('bar');
  });

  it('passes unknown tool names through unchanged', async () => {
    mockUpstream(
      `<function_calls>\n<invoke name="custom_thing">\n<parameter name="x">y</parameter>\n</invoke>\n</function_calls>`,
    );

    const server = buildServer(cfg());
    const resp = await callEnvelope(server);
    const envelope = JSON.parse(
      resp.json<{ choices: Array<{ message: { content: string } }> }>().choices[0]?.message
        .content ?? '{}',
    ) as { tool_name: string; tool_args: Record<string, unknown> };

    expect(envelope.tool_name).toBe('custom_thing');
    expect(envelope.tool_args.x).toBe('y');
  });

  it('falls back to plain "response" wrap when no XML present', async () => {
    mockUpstream('Just a plain text reply, no function calls at all.');

    const server = buildServer(cfg());
    const resp = await callEnvelope(server);
    const envelope = JSON.parse(
      resp.json<{ choices: Array<{ message: { content: string } }> }>().choices[0]?.message
        .content ?? '{}',
    ) as { tool_name: string; tool_args: { text: string } };
    expect(envelope.tool_name).toBe('response');
    expect(envelope.tool_args.text).toContain('Just a plain text reply');
  });
});
