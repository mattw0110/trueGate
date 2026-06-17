import { describe, it, expect } from 'vitest';
import {
  detectClientConvention,
  canonicalize,
  parseXmlFunctionCall,
  parseAgentZeroEnvelope,
  parseOpenAIToolCall,
  parseAnthropicToolUse,
  stripFences,
  translateResponseToConvention,
  extractAdvertisedAgentZeroTools,
} from '../../src/proxy/tool-translation.js';
import type {
  ChatCompletionRequest,
  ChatCompletionResponse,
  ChatMessage,
} from '../../src/types/providers.js';

function res(message: ChatMessage): ChatCompletionResponse {
  return {
    id: 'x',
    object: 'chat.completion',
    created: 1,
    model: 'm',
    choices: [{ index: 0, message, finish_reason: 'stop' }],
  };
}

describe('detectClientConvention', () => {
  it('detects agent-zero envelope via response_format json_schema name', () => {
    const req = {
      model: 'm',
      messages: [],
      response_format: {
        type: 'json_schema',
        json_schema: { name: 'agent_zero_envelope', schema: {} },
      },
    } as unknown as ChatCompletionRequest;
    expect(detectClientConvention(req)).toBe('agent-zero');
  });

  it('detects OpenAI tools via tools[].type === function', () => {
    const req = {
      model: 'm',
      messages: [],
      tools: [{ type: 'function', function: { name: 'foo', parameters: {} } }],
    } as unknown as ChatCompletionRequest;
    expect(detectClientConvention(req)).toBe('openai-tools');
  });

  it('detects Anthropic tools via tools[].input_schema', () => {
    const req = {
      model: 'm',
      messages: [],
      tools: [{ name: 'foo', description: 'x', input_schema: { type: 'object' } }],
    } as unknown as ChatCompletionRequest;
    expect(detectClientConvention(req)).toBe('anthropic-tools');
  });

  it('falls back to plain when nothing matches', () => {
    expect(detectClientConvention({ model: 'm', messages: [] } as ChatCompletionRequest)).toBe(
      'plain',
    );
  });
});

describe('canonicalize — new mappings', () => {
  it('maps Claude Code Task → call_subordinate, folding description into message', () => {
    const c = canonicalize('Task', {
      description: 'Find the bug',
      prompt: 'Investigate src/foo.ts and report.',
      subagent_type: 'general-purpose',
    });
    expect(c.name).toBe('call_subordinate');
    expect(c.args.message).toContain('Find the bug');
    expect(c.args.message).toContain('Investigate src/foo.ts');
    expect(c.args.profile).toBe('general-purpose');
    expect(c.args.reset).toBe('false');
  });

  it('maps WebSearch → search_engine (current live search tool)', () => {
    const c = canonicalize('WebSearch', { query: 'fastify hooks' });
    expect(c.name).toBe('search_engine');
    expect(c.args.query).toBe('fastify hooks');
  });

  it('maps WebFetch → document_query (current live tool name)', () => {
    const c = canonicalize('WebFetch', { url: 'https://example.com/report.pdf' });
    expect(c.name).toBe('document_query');
    expect(c.args.document).toBe('https://example.com/report.pdf');
  });

  it('maps TodoWrite → response with summarized todo list', () => {
    const c = canonicalize('TodoWrite', {
      todos: [
        { content: 'do A', status: 'pending' },
        { content: 'do B', status: 'in_progress' },
      ],
    });
    expect(c.name).toBe('response');
    expect(typeof c.args.text).toBe('string');
    expect(String(c.args.text)).toContain('do A');
    expect(String(c.args.text)).toContain('in_progress');
  });

  it('maps MultiEdit → text_editor str_replace with additional_edits', () => {
    const c = canonicalize('MultiEdit', {
      file_path: '/tmp/x.py',
      edits: [
        { old_string: 'a', new_string: 'b' },
        { old_string: 'c', new_string: 'd' },
      ],
    });
    expect(c.name).toBe('text_editor');
    expect(c.args.action).toBe('patch');
    expect(c.args.path).toBe('/tmp/x.py');
    // Both edits are bundled into one patch_text in agent-zero's format.
    expect(c.args.patch_text).toContain('-a');
    expect(c.args.patch_text).toContain('+b');
    expect(c.args.patch_text).toContain('-c');
    expect(c.args.patch_text).toContain('+d');
  });

  it('passes native agent-zero tools through', () => {
    const c = canonicalize('document_query', { document: '/x.pdf' });
    expect(c.name).toBe('document_query');
    expect(c.args.document).toBe('/x.pdf');
  });

  it('passes current live native tools through', () => {
    expect(canonicalize('browser', { action: 'open', url: 'https://example.com' }).name).toBe(
      'browser',
    );
    expect(canonicalize('skills_tool', { action: 'search', query: 'pdf' }).name).toBe(
      'skills_tool',
    );
    expect(canonicalize('vision_load', { paths: ['/tmp/x.png'] }).name).toBe('vision_load');
    expect(canonicalize('code_execution_remote', { runtime: 'terminal', code: 'pwd' }).name).toBe(
      'code_execution_remote',
    );
    expect(canonicalize('text_editor_remote', { action: 'read', path: 'README.md' }).name).toBe(
      'text_editor_remote',
    );
  });

  it('passes unknown tool names through unchanged', () => {
    const c = canonicalize('weird_custom_tool', { x: 1 });
    expect(c.name).toBe('weird_custom_tool');
    expect(c.args.x).toBe(1);
  });

  it('splits dotted dispatch shape "text_editor.read" into name + action', () => {
    const c = canonicalize('text_editor.read', { path: '/tmp/foo', line_from: 1, line_to: 50 });
    expect(c.name).toBe('text_editor');
    expect(c.args.action).toBe('read');
    expect(c.args.path).toBe('/tmp/foo');
    expect(c.originalName).toBe('text_editor.read');
  });

  it('splits dotted dispatch shape "code_execution_tool.terminal"', () => {
    const c = canonicalize('code_execution_tool.terminal', { code: 'ls' });
    expect(c.name).toBe('code_execution_tool');
    expect(c.args.action).toBe('terminal');
    expect(c.args.code).toBe('ls');
  });

  it('does not split dotted names when args already supply action', () => {
    const c = canonicalize('text_editor.read', { action: 'write', path: '/tmp/foo', content: 'x' });
    // existing action wins; dotted suffix is ignored rather than overwriting.
    expect(c.name).toBe('text_editor');
    expect(c.args.action).toBe('write');
  });
});

describe('stripFences', () => {
  it('strips ```json … ``` fences', () => {
    expect(stripFences('```json\n{"a":1}\n```')).toBe('{"a":1}');
  });
  it('strips bare ``` … ``` fences', () => {
    expect(stripFences('```\n{"a":1}\n```')).toBe('{"a":1}');
  });
  it('leaves unfenced content untouched', () => {
    expect(stripFences('{"a":1}')).toBe('{"a":1}');
  });
});

describe('parseAgentZeroEnvelope', () => {
  it('parses a raw JSON envelope', () => {
    const c = parseAgentZeroEnvelope(
      '{"thoughts":["t"],"headline":"h","tool_name":"response","tool_args":{"text":"hi"}}',
    );
    expect(c?.name).toBe('response');
    expect(c?.args.text).toBe('hi');
    expect(c?.preface).toBe('t');
  });

  it('parses a fenced JSON envelope', () => {
    const c = parseAgentZeroEnvelope(
      '```json\n{"thoughts":["t"],"headline":"h","tool_name":"response","tool_args":{"text":"hi"}}\n```',
    );
    expect(c?.name).toBe('response');
    expect(c?.args.text).toBe('hi');
  });

  it('returns null on non-envelope JSON', () => {
    expect(parseAgentZeroEnvelope('{"some":"object"}')).toBeNull();
  });

  it('case-2 recovery: response envelope with prose tool call in text → real tool call', () => {
    const envelopeJson = JSON.stringify({
      thoughts: ['Reasoning here'],
      headline: 'Reading file',
      tool_name: 'response',
      tool_args: {
        text: `Let me read the prompt to see what instructions are in place.\n\ntext_editor\n\nread\n/a0/foo.py\n50\n95`,
      },
    });
    const c = parseAgentZeroEnvelope(envelopeJson);
    expect(c?.name).toBe('text_editor');
    expect(c?.args.action).toBe('read');
    expect(c?.args.path).toBe('/a0/foo.py');
    expect(c?.args.line_from).toBe(50);
    expect(c?.args.line_to).toBe(95);
  });

  it('case-2: response envelope with normal text (no embedded tool call) stays as response', () => {
    const envelopeJson = JSON.stringify({
      thoughts: ['t'],
      headline: 'h',
      tool_name: 'response',
      tool_args: { text: 'Hi there, just a normal answer with no tool call.' },
    });
    const c = parseAgentZeroEnvelope(envelopeJson);
    expect(c?.name).toBe('response');
    expect(c?.args.text).toContain('Hi there');
  });
});

describe('parseOpenAIToolCall', () => {
  it('extracts function-call from message.tool_calls[0]', () => {
    const c = parseOpenAIToolCall({
      role: 'assistant',
      content: 'I will read the file.',
      tool_calls: [
        {
          id: 'call_1',
          type: 'function',
          function: { name: 'Read', arguments: '{"file_path":"/tmp/x"}' },
        },
      ],
    } as unknown as ChatMessage);
    expect(c?.name).toBe('text_editor');
    expect(c?.args.action).toBe('read');
    expect(c?.args.path).toBe('/tmp/x');
    expect(c?.preface).toBe('I will read the file.');
  });
});

describe('parseAnthropicToolUse', () => {
  it('extracts tool_use block from content array', () => {
    const c = parseAnthropicToolUse({
      role: 'assistant',
      content: [
        { type: 'text', text: 'I will read it.' },
        { type: 'tool_use', id: 'tu1', name: 'Read', input: { file_path: '/tmp/x' } },
      ],
    } as unknown as ChatMessage);
    expect(c?.name).toBe('text_editor');
    expect(c?.args.path).toBe('/tmp/x');
    expect(c?.preface).toBe('I will read it.');
  });
});

describe('translateResponseToConvention', () => {
  it('agent-zero client + upstream XML → emits envelope JSON', () => {
    const r = translateResponseToConvention(
      res({
        role: 'assistant',
        content:
          '<function_calls><invoke name="Read"><parameter name="file_path">/tmp/foo</parameter></invoke></function_calls>',
      }),
      'agent-zero',
    );
    const env = JSON.parse(r.choices[0]!.message.content as string) as {
      tool_name: string;
      tool_args: Record<string, unknown>;
    };
    expect(env.tool_name).toBe('text_editor');
    expect(env.tool_args.path).toBe('/tmp/foo');
  });

  it('agent-zero client + unavailable translated tool → emits response instead of missing tool', () => {
    const r = translateResponseToConvention(
      res({
        role: 'assistant',
        content:
          '<function_calls><invoke name="Read"><parameter name="file_path">/tmp/foo</parameter></invoke></function_calls>',
      }),
      'agent-zero',
      undefined,
      new Set(['response', 'a2a_chat', 'wait']),
    );
    const env = JSON.parse(r.choices[0]!.message.content as string) as {
      tool_name: string;
      tool_args: Record<string, unknown>;
    };
    expect(env.tool_name).toBe('response');
    expect(String(env.tool_args.text)).toContain('text_editor');
    expect(String(env.tool_args.text)).toContain('not currently advertised');
  });

  it('agent-zero client + envelope with trailing chars → parses, no double-wrap', () => {
    // Reproduces the production "weird response" bug: upstream emitted a
    // valid envelope but with a stray trailing newline/whitespace that broke
    // strict JSON.parse, causing trueGate to wrap the entire envelope as a
    // STRING inside tool_args.text — the user saw escaped JSON.
    const inner = JSON.stringify({
      thoughts: ['t'],
      headline: 'h',
      tool_name: 'response',
      tool_args: { text: '## Yes — There Is Redundant Code\n\nLong markdown body.' },
    });
    const content = inner + '\n\n'; // trailing whitespace post-envelope
    const r = translateResponseToConvention(res({ role: 'assistant', content }), 'agent-zero');
    const outer = JSON.parse(r.choices[0]!.message.content as string) as {
      tool_name: string;
      tool_args: { text: string };
    };
    expect(outer.tool_name).toBe('response');
    // The text should be the markdown body, NOT a stringified envelope.
    expect(outer.tool_args.text).toContain('## Yes');
    expect(outer.tool_args.text).not.toMatch(/\\"tool_name\\"/);
    expect(outer.tool_args.text).not.toMatch(/^\{"thoughts"/);
  });

  it('agent-zero client + GPT envelope missing final brace before punctuation junk → recovers tool call', () => {
    const inner = JSON.stringify({
      thoughts: ['The user asked to use sequential thinking before code edits.'],
      headline: 'Invoking sequential thinking',
      tool_name: 'sequential_thinking.sequentialthinking',
      tool_args: {
        thought: 'Goal: fix content-readiness false positives.',
        thoughtNumber: 1,
        totalThoughts: 4,
        nextThoughtNeeded: true,
      },
    });
    const missingFinalBrace = inner.slice(0, -1);
    const content = `${missingFinalBrace}((&___\n\n— trueGate · cliproxy/gpt-5.5`;
    const r = translateResponseToConvention(res({ role: 'assistant', content }), 'agent-zero');
    const outer = JSON.parse(r.choices[0]!.message.content as string) as {
      tool_name: string;
      tool_args: Record<string, unknown>;
    };

    expect(outer.tool_name).toBe('sequential_thinking.sequentialthinking');
    expect(outer.tool_args.thoughtNumber).toBe(1);
    expect(outer.tool_args.nextThoughtNeeded).toBe(true);
  });

  it('agent-zero client + envelope with raw newline in string → recovers intended envelope', () => {
    // Pathological case: an envelope-shaped string with a JSON-illegal byte
    // (e.g. raw newline inside a string literal). Claude Code emits this often
    // enough that trueGate should repair it instead of terminating the loop.
    const malformed =
      '{"thoughts":["t"],"headline":"h","tool_name":"response","tool_args":{"text":"line1\nline2"}}';
    const r = translateResponseToConvention(
      res({ role: 'assistant', content: malformed }),
      'agent-zero',
    );
    const outer = JSON.parse(r.choices[0]!.message.content as string) as {
      tool_name: string;
      tool_args: { text: string };
    };
    expect(outer.tool_name).toBe('response');
    expect(outer.tool_args.text).toBe('line1\nline2');
  });

  it('agent-zero client + malformed text_editor envelope with multiline edit text → recovers tool call', () => {
    const malformed =
      '{"thoughts":["editing"],"headline":"edit","tool_name":"text_editor","tool_args":{"action":"edit","path":"/tmp/x","old_text":"line1\nline2","new_text":"line1\nline changed"}}';
    const r = translateResponseToConvention(
      res({ role: 'assistant', content: malformed }),
      'agent-zero',
    );
    const outer = JSON.parse(r.choices[0]!.message.content as string) as {
      tool_name: string;
      tool_args: { action: string; path: string; old_text?: string; new_text?: string };
    };
    expect(outer.tool_name).toBe('text_editor');
    expect(outer.tool_args.action).toBe('edit');
    expect(outer.tool_args.path).toBe('/tmp/x');
    expect(outer.tool_args.old_text).toBe('line1\nline2');
    expect(outer.tool_args.new_text).toBe('line1\nline changed');
  });
});

describe('parseAgentZeroEnvelope (parser robustness)', () => {
  it('accepts an envelope with leading prose', () => {
    const env = JSON.stringify({
      thoughts: [],
      headline: 'h',
      tool_name: 'response',
      tool_args: { text: 'hi' },
    });
    const r = parseAgentZeroEnvelope(`Sure, here you go:\n${env}`);
    expect(r?.name).toBe('response');
    expect(r?.args.text).toBe('hi');
  });

  it('accepts an envelope with trailing prose', () => {
    const env = JSON.stringify({
      thoughts: [],
      headline: 'h',
      tool_name: 'response',
      tool_args: { text: 'hi' },
    });
    const r = parseAgentZeroEnvelope(`${env}\n\nTrailing note.`);
    expect(r?.name).toBe('response');
    expect(r?.args.text).toBe('hi');
  });
});

describe('translateResponseToConvention — openai-tools and anthropic-tools', () => {
  it('openai-tools client + upstream XML → emits tool_calls', () => {
    const r = translateResponseToConvention(
      res({
        role: 'assistant',
        content:
          'Calling tool.\n<function_calls><invoke name="Bash"><parameter name="command">ls</parameter></invoke></function_calls>',
      }),
      'openai-tools',
    );
    const msg = r.choices[0]!.message as unknown as {
      content: string;
      tool_calls: Array<{ function: { name: string; arguments: string } }>;
    };
    expect(msg.tool_calls).toHaveLength(1);
    expect(msg.tool_calls[0]!.function.name).toBe('code_execution_tool');
    const args = JSON.parse(msg.tool_calls[0]!.function.arguments) as Record<string, unknown>;
    expect(args.runtime).toBe('terminal');
    expect(args.code).toBe('ls');
    expect(msg.content).toContain('Calling tool');
  });

  it('anthropic-tools client + upstream tool_use → emits tool_use content blocks', () => {
    const r = translateResponseToConvention(
      res({
        role: 'assistant',
        content: [
          { type: 'text', text: 'plan' },
          { type: 'tool_use', id: 't1', name: 'Read', input: { file_path: '/tmp/x' } },
        ],
      } as unknown as ChatMessage),
      'anthropic-tools',
    );
    const blocks = r.choices[0]!.message.content as unknown as Array<Record<string, unknown>>;
    expect(Array.isArray(blocks)).toBe(true);
    const toolUse = blocks.find((b) => b.type === 'tool_use')!;
    expect(toolUse.name).toBe('text_editor');
    expect((toolUse.input as Record<string, unknown>).path).toBe('/tmp/x');
  });

  it('plain client → leaves response untouched', () => {
    const orig = res({ role: 'assistant', content: 'just text' });
    expect(translateResponseToConvention(orig, 'plain')).toBe(orig);
  });

  it('agent-zero client + no tool call detected → wraps prose as response envelope', () => {
    const r = translateResponseToConvention(
      res({ role: 'assistant', content: 'Just chatting.' }),
      'agent-zero',
    );
    const env = JSON.parse(r.choices[0]!.message.content as string) as {
      tool_name: string;
      tool_args: { text: string };
    };
    expect(env.tool_name).toBe('response');
    expect(env.tool_args.text).toBe('Just chatting.');
  });

  it('agent-zero client + fenced JSON envelope → re-emits without fences', () => {
    const r = translateResponseToConvention(
      res({
        role: 'assistant',
        content:
          '```json\n{"thoughts":["t"],"headline":"h","tool_name":"response","tool_args":{"text":"hi"}}\n```',
      }),
      'agent-zero',
    );
    const txt = r.choices[0]!.message.content as string;
    expect(txt.startsWith('{')).toBe(true);
    expect(txt).not.toContain('```');
    const env = JSON.parse(txt) as { tool_name: string };
    expect(env.tool_name).toBe('response');
  });
});

describe('parseProseToolCall (last-resort fallback for prose tool calls)', () => {
  it('recognizes text_editor read with positional path / start / end', async () => {
    const { parseProseToolCall } = await import('../../src/proxy/tool-translation.js');
    const c = parseProseToolCall(
      `I need to analyze why the writer is still producing these specific blockers despite our previous fixes. Let me read the current writer prompt to see what instructions are in place.\n\ntext_editor\n\nread\n/a0/usr/projects/truemarketing/backend/prompts/article_draft_system.py\n1\n130`,
    );
    expect(c?.name).toBe('text_editor');
    expect(c?.args.action).toBe('read');
    expect(c?.args.path).toBe(
      '/a0/usr/projects/truemarketing/backend/prompts/article_draft_system.py',
    );
    expect(c?.args.line_from).toBe(1);
    expect(c?.args.line_to).toBe(130);
    expect(c?.preface).toContain('analyze why');
  });

  it('recognizes code_execution_tool with runtime + multi-line code', async () => {
    const { parseProseToolCall } = await import('../../src/proxy/tool-translation.js');
    const c = parseProseToolCall(
      `reasoning here\n\ncode_execution_tool\nterminal\nls -la /tmp\necho ok`,
    );
    expect(c?.name).toBe('code_execution_tool');
    expect(c?.args.runtime).toBe('terminal');
    expect(c?.args.code).toBe('ls -la /tmp\necho ok');
  });

  it('recognizes text_editor_remote with positional path / start / end', async () => {
    const { parseProseToolCall } = await import('../../src/proxy/tool-translation.js');
    const c = parseProseToolCall(`text_editor_remote\nread\nREADME.md\n1\n80`);
    expect(c?.name).toBe('text_editor_remote');
    expect(c?.args.action).toBe('read');
    expect(c?.args.path).toBe('README.md');
    expect(c?.args.line_from).toBe(1);
    expect(c?.args.line_to).toBe(80);
  });

  it('recognizes code_execution_remote with runtime + code', async () => {
    const { parseProseToolCall } = await import('../../src/proxy/tool-translation.js');
    const c = parseProseToolCall(`code_execution_remote\nterminal\npwd`);
    expect(c?.name).toBe('code_execution_remote');
    expect(c?.args.runtime).toBe('terminal');
    expect(c?.args.code).toBe('pwd');
  });

  it('returns null when no known tool name appears on its own line', async () => {
    const { parseProseToolCall } = await import('../../src/proxy/tool-translation.js');
    expect(
      parseProseToolCall('Just a regular response about text_editor capabilities.'),
    ).toBeNull();
  });

  it('returns null when tool name is present but no following args', async () => {
    const { parseProseToolCall } = await import('../../src/proxy/tool-translation.js');
    expect(parseProseToolCall('text_editor')).toBeNull();
  });

  it('rejects when first positional fails the per-tool command whitelist (text_editor)', async () => {
    const { parseProseToolCall } = await import('../../src/proxy/tool-translation.js');
    // "explanation" is not in {read,view,create,write,str_replace,edit} so this is prose, not a tool call
    const c = parseProseToolCall(`Some context.\n\ntext_editor\n\nexplanation\nfoo\nbar`);
    expect(c).toBeNull();
  });

  it('rejects when tool name appears too deep in the content (>8 non-blank lines)', async () => {
    const { parseProseToolCall } = await import('../../src/proxy/tool-translation.js');
    const prose =
      Array(15).fill('a sentence of prose.').join('\n') + `\n\ntext_editor\n\nread\n/x\n1\n2`;
    expect(parseProseToolCall(prose)).toBeNull();
  });

  it('rejects when first positional fails the per-tool command whitelist (code_execution_tool)', async () => {
    const { parseProseToolCall } = await import('../../src/proxy/tool-translation.js');
    // "analysis" is not a real runtime
    const c = parseProseToolCall(`Some lead-in.\n\ncode_execution_tool\n\nanalysis\nfoo`);
    expect(c).toBeNull();
  });

  it('translateResponseToConvention(agent-zero) recovers a prose tool call', () => {
    const r = translateResponseToConvention(
      res({
        role: 'assistant',
        content: `Let me read the file.\n\ntext_editor\n\nread\n/tmp/foo.py\n1\n50`,
      }),
      'agent-zero',
    );
    const env = JSON.parse(r.choices[0]!.message.content as string) as {
      tool_name: string;
      tool_args: Record<string, unknown>;
    };
    expect(env.tool_name).toBe('text_editor');
    expect(env.tool_args.path).toBe('/tmp/foo.py');
    expect(env.tool_args.line_from).toBe(1);
    expect(env.tool_args.line_to).toBe(50);
  });
});

describe('parseToolAsTagXml (subordinate dialect: tool name as outer XML tag)', () => {
  it('translates <code_execution_tool><runtime>…</runtime><code>…</code></code_execution_tool>', async () => {
    const { parseToolAsTagXml } = await import('../../src/proxy/tool-translation.js');
    const c = parseToolAsTagXml(
      `I'll run those.\n<code_execution_tool>\n<runtime>terminal</runtime>\n<code>cd /repo && git fetch origin</code>\n</code_execution_tool>`,
    );
    expect(c?.name).toBe('code_execution_tool');
    expect(c?.args.runtime).toBe('terminal');
    expect(c?.args.code).toBe('cd /repo && git fetch origin');
    expect(c?.preface).toContain("I'll run those");
  });

  it('translates <text_editor><command>view</command><path>/foo</path></text_editor>', async () => {
    const { parseToolAsTagXml } = await import('../../src/proxy/tool-translation.js');
    const c = parseToolAsTagXml(
      `<text_editor><command>view</command><path>/foo/bar.py</path></text_editor>`,
    );
    expect(c?.name).toBe('text_editor');
    // Even when the model emits Claude-Code-style {command:view}, canonicalize
    // normalizes to agent-zero's {action:read} schema.
    expect(c?.args.action).toBe('read');
    expect(c?.args.path).toBe('/foo/bar.py');
  });

  it('passes current live native tool tags through unchanged', async () => {
    const { parseToolAsTagXml } = await import('../../src/proxy/tool-translation.js');
    const browser = parseToolAsTagXml(
      `<browser><action>open</action><url>https://example.com</url></browser>`,
    );
    expect(browser?.name).toBe('browser');
    expect(browser?.args.action).toBe('open');
    expect(browser?.args.url).toBe('https://example.com');

    const skills = parseToolAsTagXml(
      `<skills_tool><action>search</action><query>host file edit</query></skills_tool>`,
    );
    expect(skills?.name).toBe('skills_tool');
    expect(skills?.args.action).toBe('search');
    expect(skills?.args.query).toBe('host file edit');
  });

  it('handles multi-line <code> blocks with backslash continuations', async () => {
    const { parseToolAsTagXml } = await import('../../src/proxy/tool-translation.js');
    const codeBlob = `cd /repo && \\\necho "=== A ===" && \\\ngit log --oneline`;
    const c = parseToolAsTagXml(
      `<code_execution_tool><runtime>terminal</runtime><code>${codeBlob}</code></code_execution_tool>`,
    );
    expect(c?.args.code).toBe(codeBlob);
  });

  it('returns null when the outer tag is not a known agent-zero tool', async () => {
    const { parseToolAsTagXml } = await import('../../src/proxy/tool-translation.js');
    expect(parseToolAsTagXml(`<random_thing><x>y</x></random_thing>`)).toBeNull();
  });

  it('parseUpstreamCall picks up the tool-as-tag form end-to-end', () => {
    const r = translateResponseToConvention(
      res({
        role: 'assistant',
        content: `<code_execution_tool><runtime>terminal</runtime><code>git status</code></code_execution_tool>`,
      }),
      'agent-zero',
    );
    const env = JSON.parse(r.choices[0]!.message.content as string) as {
      tool_name: string;
      tool_args: Record<string, unknown>;
    };
    expect(env.tool_name).toBe('code_execution_tool');
    expect(env.tool_args.code).toBe('git status');
  });
});

describe('parseExecuteCommandXml (subordinate-agent dialect)', () => {
  it('translates <execute_command><command>git push</command></execute_command> to code_execution_tool/terminal', async () => {
    const { parseExecuteCommandXml } = await import('../../src/proxy/tool-translation.js');
    const c = parseExecuteCommandXml(
      `Some lead-in.\n<execute_command>\n<command>cd /repo && git push origin main</command>\n</execute_command>`,
    );
    expect(c?.name).toBe('code_execution_tool');
    expect(c?.args.runtime).toBe('terminal');
    expect(c?.args.code).toBe('cd /repo && git push origin main');
    expect(c?.originalName).toBe('execute_command');
    expect(c?.preface).toContain('Some lead-in');
  });

  it('bundles multiple blocks into one &&-chained shell call', async () => {
    const { parseExecuteCommandXml } = await import('../../src/proxy/tool-translation.js');
    const c = parseExecuteCommandXml(
      `<execute_command><command>git status</command></execute_command>\n<execute_command><command>git log -1</command></execute_command>`,
    );
    expect(c?.args.code).toContain('git status');
    expect(c?.args.code).toContain('git log -1');
    expect(c?.args.code).toContain('&&');
    expect(c?.preface).toContain('bundled 2');
  });

  it('recognizes <run_terminal_command> dialect with multiple blocks', async () => {
    const { parseExecuteCommandXml } = await import('../../src/proxy/tool-translation.js');
    const content = [
      `<run_terminal_command>`,
      `<command>cd /repo && git status</command>`,
      `<requires_approval>false</requires_approval>`,
      `</run_terminal_command>`,
      ``,
      `<run_terminal_command>`,
      `<command>git push origin main</command>`,
      `<requires_approval>false</requires_approval>`,
      `</run_terminal_command>`,
    ].join('\n');
    const c = parseExecuteCommandXml(content);
    expect(c?.name).toBe('code_execution_tool');
    expect(c?.originalName).toBe('run_terminal_command');
    expect(c?.args.code).toContain('cd /repo && git status');
    expect(c?.args.code).toContain('git push origin main');
    expect(c?.preface).toContain('bundled 2');
  });

  it('returns null when no execute_command block exists', async () => {
    const { parseExecuteCommandXml } = await import('../../src/proxy/tool-translation.js');
    expect(parseExecuteCommandXml('Just some prose with no XML at all.')).toBeNull();
  });

  it('parseUpstreamCall chains the new parser after the existing ones', () => {
    const r = translateResponseToConvention(
      res({
        role: 'assistant',
        content: `<execute_command><command>ls /tmp</command></execute_command>`,
      }),
      'agent-zero',
    );
    const env = JSON.parse(r.choices[0]!.message.content as string) as {
      tool_name: string;
      tool_args: Record<string, unknown>;
    };
    expect(env.tool_name).toBe('code_execution_tool');
    expect(env.tool_args.runtime).toBe('terminal');
    expect(env.tool_args.code).toBe('ls /tmp');
  });
});

describe('looksLikePlanOfRecord', () => {
  it('flags "Let me check…" stall', async () => {
    const { looksLikePlanOfRecord } = await import('../../src/proxy/tool-translation.js');
    expect(looksLikePlanOfRecord('Let me check the writer prompt.')).toBe(true);
  });
  it('flags "I need to investigate…" stall', async () => {
    const { looksLikePlanOfRecord } = await import('../../src/proxy/tool-translation.js');
    expect(
      looksLikePlanOfRecord(
        `I need to check the current state.\n\nLet me first look at what memories we have.`,
      ),
    ).toBe(true);
  });
  it('flags "Starting with…" stall', async () => {
    const { looksLikePlanOfRecord } = await import('../../src/proxy/tool-translation.js');
    expect(looksLikePlanOfRecord('Starting with route source inspection now.')).toBe(true);
  });
  it('does NOT flag genuine final answers', async () => {
    const { looksLikePlanOfRecord } = await import('../../src/proxy/tool-translation.js');
    expect(looksLikePlanOfRecord('The bug is on line 42 of foo.py — missing null check.')).toBe(
      false,
    );
  });
  it('does NOT flag content that already contains a tool call', async () => {
    const { looksLikePlanOfRecord } = await import('../../src/proxy/tool-translation.js');
    expect(
      looksLikePlanOfRecord(
        `Let me check.\n<function_calls><invoke name="Read"><parameter name="file_path">/x</parameter></invoke></function_calls>`,
      ),
    ).toBe(false);
  });
});

describe('looksLikeRawStructuredOutput', () => {
  it('flags bare JSON arrays even after trueGate marker text', async () => {
    const { looksLikeRawStructuredOutput } = await import('../../src/proxy/tool-translation.js');
    expect(
      looksLikeRawStructuredOutput(
        `["client article creation", "XML sitemap"]\n\n— trueGate · cliproxy/gpt-5.4-mini`,
      ),
    ).toBe(true);
  });

  it('flags bare JSON objects but not Agent Zero envelopes', async () => {
    const { looksLikeRawStructuredOutput } = await import('../../src/proxy/tool-translation.js');
    expect(looksLikeRawStructuredOutput('{"memory":"x"}')).toBe(true);
    expect(
      looksLikeRawStructuredOutput(
        '{"thoughts":["ok"],"headline":"h","tool_name":"response","tool_args":{"text":"done"}}',
      ),
    ).toBe(false);
  });

  it('logs raw structured output separately from unknown parser misses', () => {
    const logs: Array<{ level: 'warn' | 'info'; msg: string }> = [];
    const r = translateResponseToConvention(
      res({
        role: 'assistant',
        content: '["client article creation", "XML sitemap"]\n\n— trueGate · cliproxy/gpt-5.4-mini',
      }),
      'agent-zero',
      (level, msg) => logs.push({ level, msg }),
    );
    const env = JSON.parse(r.choices[0]!.message.content as string) as {
      tool_name: string;
      tool_args: { text: string };
    };

    expect(env.tool_name).toBe('response');
    expect(env.tool_args.text).toContain('XML sitemap');
    expect(logs.some((entry) => entry.msg.includes('RAW STRUCTURED OUTPUT'))).toBe(true);
    expect(logs.some((entry) => entry.msg.includes('no parser matched'))).toBe(false);
  });

  it('translates bare JSON-array tool calls instead of wrapping them as response text', () => {
    const r = translateResponseToConvention(
      res({
        role: 'assistant',
        content:
          '[{"tool_name":"text_editor","action":"view","path":"/a0/usr/projects/truemarketing/package.json"}]',
      }),
      'agent-zero',
    );
    const env = JSON.parse(r.choices[0]!.message.content as string) as {
      tool_name: string;
      tool_args: { action: string; path: string };
    };

    expect(env.tool_name).toBe('text_editor');
    expect(env.tool_args.action).toBe('view');
    expect(env.tool_args.path).toBe('/a0/usr/projects/truemarketing/package.json');
  });
});

describe('parseReadFilesXml', () => {
  it('translates <read_files><path>X</path></read_files> to text_editor.read of first path', async () => {
    const { parseReadFilesXml } = await import('../../src/proxy/tool-translation.js');
    const c = parseReadFilesXml(
      'Let me check the writer.\n<read_files>\n<path>backend/prompts/article_draft_system.py</path>\n<path>backend/services/_pre_review_content_quality_checks.py</path>\n</read_files>',
    );
    expect(c?.name).toBe('text_editor');
    expect(c?.args.action).toBe('read');
    expect(c?.args.path).toBe('backend/prompts/article_draft_system.py');
    expect(c?.preface).toMatch(/Let me check/);
    expect(c?.preface).toMatch(/2 files/);
  });

  it('handles singular <read_file>', async () => {
    const { parseReadFilesXml } = await import('../../src/proxy/tool-translation.js');
    const c = parseReadFilesXml('<read_file><path>/a/b.ts</path></read_file>');
    expect(c?.name).toBe('text_editor');
    expect(c?.args.path).toBe('/a/b.ts');
  });

  it('returns null when no <path> children present', async () => {
    const { parseReadFilesXml } = await import('../../src/proxy/tool-translation.js');
    expect(parseReadFilesXml('<read_files></read_files>')).toBeNull();
  });

  it('returns null when no <read_files> wrapper', async () => {
    const { parseReadFilesXml } = await import('../../src/proxy/tool-translation.js');
    expect(parseReadFilesXml('just prose, no tags')).toBeNull();
  });
});

describe('parseDominantBashFence', () => {
  it('translates a dominant bash fence to code_execution_tool/terminal', async () => {
    const { parseDominantBashFence } = await import('../../src/proxy/tool-translation.js');
    const c = parseDominantBashFence(
      'Run these commands:\n```bash\ngit status\ngit add -A\ngit commit -m "x"\n```',
    );
    expect(c?.name).toBe('code_execution_tool');
    expect(c?.args.runtime).toBe('terminal');
    expect(c?.args.code).toContain('git status');
    expect(c?.args.code).toContain('git commit');
  });

  it('also matches ```sh and ```shell', async () => {
    const { parseDominantBashFence } = await import('../../src/proxy/tool-translation.js');
    expect(parseDominantBashFence('```sh\nls\n```')?.name).toBe('code_execution_tool');
    expect(parseDominantBashFence('```shell\nls\n```')?.name).toBe('code_execution_tool');
  });

  it('does NOT fire when there are multiple bash fences', async () => {
    const { parseDominantBashFence } = await import('../../src/proxy/tool-translation.js');
    expect(parseDominantBashFence('```bash\nls\n```\nthen\n```bash\npwd\n```')).toBeNull();
  });

  it('does NOT fire when prose outside the fence is long (illustrative example)', async () => {
    const { parseDominantBashFence } = await import('../../src/proxy/tool-translation.js');
    const longProse = 'x'.repeat(500);
    expect(parseDominantBashFence(`${longProse}\n\`\`\`bash\nls\n\`\`\``)).toBeNull();
  });

  it('does NOT fire when fence contains only comments', async () => {
    const { parseDominantBashFence } = await import('../../src/proxy/tool-translation.js');
    expect(parseDominantBashFence('```bash\n# just a comment\n```')).toBeNull();
  });
});

describe('parseUpstreamCall integration — <read_files> recovers tool call', () => {
  it('upgrades a <read_files> response to a text_editor.read tool call (agent-zero convention)', () => {
    const response = res({
      role: 'assistant',
      content:
        'I need to check the writer prompts.\n<read_files>\n<path>backend/prompts/article_draft_system.py</path>\n</read_files>',
    });
    const req = {
      model: 'm',
      messages: [],
      response_format: {
        type: 'json_schema',
        json_schema: { name: 'agent_zero_envelope', schema: {} },
      },
    } as unknown as ChatCompletionRequest;
    const out = translateResponseToConvention(response, detectClientConvention(req));
    const msg = out.choices[0]?.message?.content as string;
    const parsed = JSON.parse(msg);
    expect(parsed.tool_name).toBe('text_editor');
    expect(parsed.tool_args.action).toBe('read');
    expect(parsed.tool_args.path).toBe('backend/prompts/article_draft_system.py');
  });
});

describe('extractAdvertisedAgentZeroTools', () => {
  it('accepts trailing colons on tool headers (input:, response:)', () => {
    const systemMsg = [
      '## available tools',
      'use ONLY the tools listed below.',
      '### a2a_chat',
      '### code_execution_tool',
      '### input:',
      '### response:',
      '### text_editor',
    ].join('\n');
    const tools = extractAdvertisedAgentZeroTools([{ role: 'system', content: systemMsg }]);
    expect(tools).toBeDefined();
    expect(tools!.has('input')).toBe(true);
    expect(tools!.has('response')).toBe(true);
    expect(tools!.has('text_editor')).toBe(true);
    expect(tools!.has('code_execution_tool')).toBe(true);
  });
});

describe('parseXmlFunctionCall (smoke)', () => {
  it('extracts JSON-array function_calls emitted by Claude through Agent Zero', () => {
    const c = parseXmlFunctionCall(
      'Let me inspect it.\n<function_calls>[{"tool_name":"text_editor","action":"view","path":"/home/mwhite/projects/edm_source/src/pages/artists/[slug].astro"}]</function_calls>',
    );
    expect(c?.name).toBe('text_editor');
    expect(c?.args.action).toBe('view');
    expect(c?.args.path).toBe('/home/mwhite/projects/edm_source/src/pages/artists/[slug].astro');
    expect(c?.preface).toBe('Let me inspect it.');
  });

  it('still extracts XML invoke + parameters', () => {
    const c = parseXmlFunctionCall(
      '<function_calls><invoke name="Write"><parameter name="file_path">/x</parameter><parameter name="content">hi</parameter></invoke></function_calls>',
    );
    expect(c?.name).toBe('text_editor');
    expect(c?.args.action).toBe('write');
    expect(c?.args.path).toBe('/x');
    expect(c?.args.content).toBe('hi');
  });
});
