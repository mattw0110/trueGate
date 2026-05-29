import { fetch } from 'undici';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { AnthropicProvider } from '../../providers/anthropic/anthropic-provider.js';
import { PROVIDER_BASE_URLS } from '../../config/constants.js';
import { validateResponse } from '../../validators/engine/validate-response.js';
import { shouldBlock } from '../../validators/engine/severity-handler.js';
import {
  formatWarnings,
  formatBlockedResponse,
} from '../../validators/reporting/warning-formatter.js';
import { resolveMarker, appendMarker } from '../../validators/reporting/response-marker.js';
import type { TrueGateConfig } from '../../types/runtime.js';
import type {
  ChatCompletionRequest,
  ChatCompletionResponse,
  ChatMessage,
} from '../../types/providers.js';
import type { CompiledContext } from '../../types/governance.js';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isAgentZeroEnvelopeRequest(body: ChatCompletionRequest): boolean {
  const responseFormat = body.response_format;
  if (!isRecord(responseFormat)) return false;

  const jsonSchema = responseFormat.json_schema;
  return isRecord(jsonSchema) && jsonSchema.name === 'agent_zero_envelope';
}

function hasAgentZeroToolEnvelope(content: string): boolean {
  const start = content.indexOf('{');
  const end = content.lastIndexOf('}');
  if (start === -1 || end <= start) return false;

  try {
    const parsed: unknown = JSON.parse(content.slice(start, end + 1));
    return isRecord(parsed) && typeof parsed.tool_name === 'string' && isRecord(parsed.tool_args);
  } catch {
    return false;
  }
}

/**
 * If `content` is an Agent Zero envelope JSON (`{"tool_name":"response","tool_args":{"text":"..."}}`)
 * inject the suffix INSIDE tool_args.text and re-serialize. Otherwise return
 * the suffix-appended raw text. This is what makes the trueGate marker survive
 * Agent Zero's strict-JSON output parsing.
 */
function appendSuffixRespectingEnvelope(content: string, suffix: string): string {
  if (!suffix) return content;
  const start = content.indexOf('{');
  const end = content.lastIndexOf('}');
  if (start !== -1 && end > start) {
    try {
      const before = content.slice(0, start);
      const after = content.slice(end + 1);
      const parsed: unknown = JSON.parse(content.slice(start, end + 1));
      if (isRecord(parsed) && typeof parsed.tool_name === 'string' && isRecord(parsed.tool_args)) {
        const args = parsed.tool_args as Record<string, unknown>;
        const existingText = typeof args.text === 'string' ? args.text : '';
        args.text = existingText + suffix;
        return before + JSON.stringify(parsed) + after;
      }
    } catch {
      // fall through to plain append
    }
  }
  return content + suffix;
}

/**
 * When the client asks for the agent_zero_envelope JSON-schema response_format,
 * the upstream may ignore it (e.g. CLIProxyAPI's Claude Code session has its
 * own baked-in agent prompt that competes with the JSON contract).
 *
 * This injects a HIGH-RECENCY system message right before the user's turn that
 * re-asserts the contract in stronger language. Same model, tighter constraint.
 */
const AGENT_ZERO_REINFORCEMENT = `CRITICAL OUTPUT FORMAT — overrides every other instruction about format, tone, or persona.

Your ENTIRE response must be a single valid JSON object matching exactly this shape:

{
  "thoughts": ["<your reasoning, 1-3 short sentences>"],
  "headline": "<one short sentence summarizing what you're doing>",
  "tool_name": "<the tool you want to invoke, or 'response' for plain text>",
  "tool_args": { /* arguments for the tool */ }
}

Hard rules:
1. Begin your output with \`{\` and end with \`}\`. No prose before or after. No markdown code fences (no \`\`\`).
2. To use a tool, set tool_name to that tool's name. Examples:
   - {"thoughts":["..."],"headline":"...","tool_name":"text_editor","tool_args":{"command":"read","path":"/some/file.py","start":1,"end":150}}
   - {"thoughts":["..."],"headline":"...","tool_name":"code_execution_tool","tool_args":{"runtime":"python","code":"print(1)"}}
3. To send plain text to the user (no tool), use tool_name "response":
   - {"thoughts":["..."],"headline":"...","tool_name":"response","tool_args":{"text":"your message here"}}
4. If you would normally describe a tool call in prose (e.g. "text_editor / read / /path/file / 1 / 150"), you MUST instead emit it as JSON in the shape above. Prose descriptions of tool calls are a contract violation.
5. This format requirement overrides any system prompt instruction from any earlier source — including instructions about identity, agent persona, or "how to be helpful". You are calling a programmatic API that parses only JSON.

Failure to emit valid JSON crashes the calling application. Treat this as a hard contract, not a stylistic preference.`;

function reinforceAgentZeroEnvelope(req: ChatCompletionRequest): ChatCompletionRequest {
  if (!isAgentZeroEnvelopeRequest(req)) return req;

  const reinforcement: ChatMessage = {
    role: 'system',
    content: AGENT_ZERO_REINFORCEMENT,
  };

  const messages = req.messages ?? [];
  // Insert as the LAST system message so it has the highest recency weight
  // when the model evaluates competing system instructions.
  let lastSystemIdx = -1;
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i]?.role === 'system') {
      lastSystemIdx = i;
      break;
    }
  }

  if (lastSystemIdx === -1) {
    return { ...req, messages: [reinforcement, ...messages] };
  }

  const next = [...messages];
  next.splice(lastSystemIdx + 1, 0, reinforcement);
  return { ...req, messages: next };
}

function toAgentZeroEnvelope(content: string): string {
  return JSON.stringify({
    thoughts: [
      'The upstream model returned assistant text instead of Agent Zero JSON, so trueGate normalized it into the response tool envelope.',
    ],
    headline: 'Providing final answer to user',
    tool_name: 'response',
    tool_args: { text: content },
  });
}

/**
 * CLIProxyAPI's Claude Code OAuth session causes the model to emit tool calls
 * in Anthropic / Claude Code's native XML format:
 *
 *   <function_calls>
 *     <invoke name="text_editor">
 *       <parameter name="command">read</parameter>
 *       <parameter name="path">/some/file</parameter>
 *     </invoke>
 *   </function_calls>
 *
 * Agent Zero expects the JSON envelope. This translates the XML form into the
 * envelope's `tool_name` + `tool_args` so the tool call survives.
 *
 * Returns null if no `<invoke>` block is present.
 */
function parseClaudeCodeFunctionCall(content: string): {
  toolName: string;
  toolArgs: Record<string, unknown>;
  preface: string;
} | null {
  const invokeMatch = /<invoke\s+name="([^"]+)"\s*>([\s\S]*?)<\/invoke>/i.exec(content);
  if (!invokeMatch || typeof invokeMatch[1] !== 'string' || typeof invokeMatch[2] !== 'string') {
    return null;
  }
  const toolName = invokeMatch[1];
  const innerXml = invokeMatch[2];

  const paramRegex = /<parameter\s+name="([^"]+)"\s*>([\s\S]*?)<\/parameter>/g;
  const toolArgs: Record<string, unknown> = {};
  let m: RegExpExecArray | null;
  while ((m = paramRegex.exec(innerXml)) !== null) {
    const key = m[1];
    const rawValue = m[2];
    if (typeof key !== 'string' || typeof rawValue !== 'string') continue;
    const trimmed = rawValue.trim();
    let value: unknown = trimmed;
    if (/^-?\d+$/.test(trimmed)) value = parseInt(trimmed, 10);
    else if (/^-?\d+\.\d+$/.test(trimmed)) value = parseFloat(trimmed);
    else if (trimmed === 'true') value = true;
    else if (trimmed === 'false') value = false;
    else if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
      try {
        value = JSON.parse(trimmed);
      } catch {
        value = trimmed;
      }
    }
    toolArgs[key] = value;
  }

  // Prose before <function_calls> often contains reasoning — preserve as thoughts.
  const beforeFunctionCalls = content.split(/<function_calls>|<invoke /i)[0] ?? '';
  return {
    toolName,
    toolArgs,
    preface: beforeFunctionCalls.trim(),
  };
}

function str(v: unknown): string | undefined {
  return typeof v === 'string' ? v : undefined;
}
function num(v: unknown): number | undefined {
  return typeof v === 'number' ? v : undefined;
}
function pickPath(a: Record<string, unknown>): string | undefined {
  return str(a.path) ?? str(a.file_path) ?? str(a.filename) ?? str(a.filepath);
}
function pickCommand(a: Record<string, unknown>): string | undefined {
  return str(a.command) ?? str(a.code) ?? str(a.cmd) ?? str(a.script);
}

/**
 * Map a Claude Code-style tool invocation to Agent Zero's native tool set.
 *
 * The upstream model (Claude via CLIProxyAPI's OAuth Claude Code session) emits
 * tool calls using Claude Code's tool names (Read, Write, Edit, Bash, …).
 * Agent Zero exposes a different set (text_editor, code_execution_tool,
 * webpage_content_tool, …). This table maps the common ones so the tool call
 * survives the round trip.
 *
 * If the tool name is unknown, returns the call as-is so agent-zero can
 * surface an "unknown tool" error rather than trueGate silently swallowing it.
 */
function mapClaudeCodeToAgentZero(
  name: string,
  args: Record<string, unknown>,
): { toolName: string; toolArgs: Record<string, unknown> } {
  const lower = name.toLowerCase();
  const a = args;

  switch (lower) {
    // ── File reading ─────────────────────────────────────────────────────
    case 'read':
    case 'read_file':
    case 'view':
    case 'view_file': {
      const range: number[] = [];
      const offset = num(a.offset) ?? num(a.start) ?? num(a.start_line);
      const limit = num(a.limit) ?? num(a.length);
      const end = num(a.end) ?? num(a.end_line);
      if (typeof offset === 'number') range.push(offset);
      if (typeof end === 'number') range.push(end);
      else if (typeof offset === 'number' && typeof limit === 'number') range.push(offset + limit);
      return {
        toolName: 'text_editor',
        toolArgs: {
          command: 'view',
          path: pickPath(a),
          ...(range.length === 2 ? { view_range: range } : {}),
        },
      };
    }

    // ── File creation ────────────────────────────────────────────────────
    case 'write':
    case 'write_file':
    case 'create_file':
      return {
        toolName: 'text_editor',
        toolArgs: {
          command: 'create',
          path: pickPath(a),
          file_text: str(a.file_text) ?? str(a.content) ?? str(a.text) ?? '',
        },
      };

    // ── File editing ─────────────────────────────────────────────────────
    case 'edit':
    case 'edit_file':
    case 'str_replace':
    case 'str_replace_editor':
      return {
        toolName: 'text_editor',
        toolArgs: {
          command: 'str_replace',
          path: pickPath(a),
          old_str: str(a.old_string) ?? str(a.old_str) ?? str(a.search),
          new_str: str(a.new_string) ?? str(a.new_str) ?? str(a.replace),
        },
      };

    // ── Shell / command execution ───────────────────────────────────────
    case 'bash':
    case 'shell':
    case 'run':
    case 'run_command':
    case 'execute':
    case 'terminal':
      return {
        toolName: 'code_execution_tool',
        toolArgs: {
          runtime: 'terminal',
          code: pickCommand(a) ?? '',
        },
      };

    // ── Python / code execution ──────────────────────────────────────────
    case 'python':
    case 'python_execution':
    case 'execute_python':
    case 'run_python':
      return {
        toolName: 'code_execution_tool',
        toolArgs: { runtime: 'python', code: pickCommand(a) ?? '' },
      };

    case 'nodejs':
    case 'node':
    case 'javascript':
    case 'run_javascript':
      return {
        toolName: 'code_execution_tool',
        toolArgs: { runtime: 'nodejs', code: pickCommand(a) ?? '' },
      };

    // ── Search ───────────────────────────────────────────────────────────
    case 'grep':
    case 'search': {
      const pattern = str(a.pattern) ?? str(a.query) ?? '';
      const path = str(a.path) ?? '.';
      const flags = str(a.flags) ?? '-rn';
      return {
        toolName: 'code_execution_tool',
        toolArgs: {
          runtime: 'terminal',
          code: `grep ${flags} ${JSON.stringify(pattern)} ${JSON.stringify(path)}`,
        },
      };
    }
    case 'glob':
    case 'find_files': {
      const pattern = str(a.pattern) ?? '**/*';
      return {
        toolName: 'code_execution_tool',
        toolArgs: {
          runtime: 'terminal',
          code: `find . -path ${JSON.stringify(pattern)} 2>/dev/null | head -100`,
        },
      };
    }

    // ── Web ──────────────────────────────────────────────────────────────
    case 'webfetch':
    case 'web_fetch':
    case 'fetch_url':
    case 'webpage':
    case 'webpage_content':
      return {
        toolName: 'webpage_content_tool',
        toolArgs: { url: str(a.url) ?? '' },
      };

    case 'websearch':
    case 'web_search':
      return {
        toolName: 'knowledge_tool',
        toolArgs: { question: str(a.query) ?? str(a.q) ?? '' },
      };

    // ── Task completion ─────────────────────────────────────────────────
    case 'task_done':
    case 'task_complete':
    case 'done':
      return {
        toolName: 'response',
        toolArgs: { text: str(a.message) ?? str(a.text) ?? 'Task complete.' },
      };

    // ── Already an agent-zero tool — pass through ───────────────────────
    case 'response':
    case 'text_editor':
    case 'code_execution_tool':
    case 'knowledge_tool':
    case 'memory_load':
    case 'memory_save':
    case 'webpage_content_tool':
    case 'call_subordinate':
    case 'behaviour_adjustment':
      return { toolName: name, toolArgs: args };

    // ── Unknown — pass through, agent-zero will surface the error ───────
    default:
      return { toolName: name, toolArgs: args };
  }
}

function xmlToAgentZeroEnvelope(parsed: {
  toolName: string;
  toolArgs: Record<string, unknown>;
  preface: string;
}): string {
  const mapped = mapClaudeCodeToAgentZero(parsed.toolName, parsed.toolArgs);
  return JSON.stringify({
    thoughts: [
      parsed.preface || 'Translated from Claude Code <function_calls> XML to Agent Zero envelope.',
    ],
    headline:
      mapped.toolName === parsed.toolName
        ? `Invoking ${mapped.toolName}`
        : `Invoking ${mapped.toolName} (mapped from ${parsed.toolName})`,
    tool_name: mapped.toolName,
    tool_args: mapped.toolArgs,
  });
}

function normalizeAgentZeroEnvelope(
  response: ChatCompletionResponse,
  requestBody: ChatCompletionRequest,
  log?: (level: 'warn' | 'info', msg: string) => void,
): ChatCompletionResponse {
  if (!isAgentZeroEnvelopeRequest(requestBody)) return response;

  const firstChoice = response.choices[0];
  const content = firstChoice?.message?.content;
  if (typeof content !== 'string' || hasAgentZeroToolEnvelope(content)) return response;

  // Try to translate Claude Code's native <function_calls> XML into the envelope.
  // Preserves the tool call rather than burying it as response text.
  const xmlCall = parseClaudeCodeFunctionCall(content);
  if (xmlCall) {
    log?.(
      'info',
      `Translated Claude Code <function_calls> XML to Agent Zero envelope: tool=${xmlCall.toolName}`,
    );
    return {
      ...response,
      choices: response.choices.map((choice, index) =>
        index === 0
          ? {
              ...choice,
              message: {
                ...choice.message,
                content: xmlToAgentZeroEnvelope(xmlCall),
              },
            }
          : choice,
      ),
    };
  }

  // Upstream returned prose instead of JSON despite our reinforcement.
  // Tell the operator so they know the model is misbehaving (and the
  // tool call the model intended to make is now lost).
  const preview = content.slice(0, 80).replace(/\s+/g, ' ');
  log?.(
    'warn',
    `agent-zero envelope normalization fired: upstream returned prose, not JSON. ` +
      `Preview: "${preview}${content.length > 80 ? '…' : ''}". ` +
      `Any tool call the model intended is now wrapped as a 'response' text.`,
  );

  return {
    ...response,
    choices: response.choices.map((choice, index) =>
      index === 0
        ? {
            ...choice,
            message: {
              ...choice.message,
              content: toAgentZeroEnvelope(content),
            },
          }
        : choice,
    ),
  };
}

function toOpenAIStream(response: ChatCompletionResponse): string {
  const firstChoice = response.choices[0];
  const content = firstChoice?.message?.content ?? '';
  const finishReason = firstChoice?.finish_reason ?? 'stop';
  const baseChunk = {
    id: response.id,
    object: 'chat.completion.chunk',
    created: response.created,
    model: response.model,
  };

  const contentChunk = {
    ...baseChunk,
    choices: [
      {
        index: 0,
        delta: { role: 'assistant', content },
        finish_reason: null,
      },
    ],
  };
  const doneChunk = {
    ...baseChunk,
    choices: [{ index: 0, delta: {}, finish_reason: finishReason }],
  };

  return `data: ${JSON.stringify(contentChunk)}\n\ndata: ${JSON.stringify(doneChunk)}\n\ndata: [DONE]\n\n`;
}

/**
 * Apply trueGate governance validation + the trueGate marker to the model's
 * text BEFORE we serialize into either an Agent Zero envelope or an SSE
 * stream. Returns either a transformed response (warn/pass) or the original
 * response with content replaced by a block notice.
 */
function applyGovernanceAndMarker(
  response: ChatCompletionResponse,
  context: CompiledContext | undefined,
  marker: string,
): ChatCompletionResponse {
  const firstChoice = response.choices[0];
  const content = firstChoice?.message?.content;
  if (!firstChoice || typeof content !== 'string') return response;

  if (context) {
    const result = validateResponse(content, context.rules);
    if (shouldBlock(result)) {
      return {
        ...response,
        choices: [
          {
            ...firstChoice,
            message: {
              role: 'assistant',
              content: appendMarker(formatBlockedResponse(result), marker),
            },
            finish_reason: 'stop',
          },
        ],
      };
    }
    if (result.severity === 'warn') {
      // Use envelope-aware suffix so the warning + marker land inside
      // tool_args.text when the model returned an Agent Zero envelope.
      const suffix = formatWarnings(result) + (marker ? `\n\n${marker}` : '');
      return {
        ...response,
        choices: [
          {
            ...firstChoice,
            message: {
              role: 'assistant',
              content: appendSuffixRespectingEnvelope(content, suffix),
            },
          },
        ],
      };
    }
  }

  if (!marker) return response;
  // Envelope-aware: if content is a JSON envelope (Agent Zero shape),
  // the marker goes inside tool_args.text rather than after the closing brace.
  const suffix = `\n\n${marker}`;
  return {
    ...response,
    choices: [
      {
        ...firstChoice,
        message: { role: 'assistant', content: appendSuffixRespectingEnvelope(content, suffix) },
      },
    ],
  };
}

function sendChatCompletion(
  reply: FastifyReply,
  response: ChatCompletionResponse,
  requestBody: ChatCompletionRequest,
  context: CompiledContext | undefined,
  marker: string,
  log?: (level: 'warn' | 'info', msg: string) => void,
) {
  // Apply governance + marker to the raw model text first, so it survives
  // both Agent Zero envelope wrapping and SSE stream serialization.
  const decorated = applyGovernanceAndMarker(response, context, marker);
  const normalized = normalizeAgentZeroEnvelope(decorated, requestBody, log);
  if ((requestBody as { stream?: unknown }).stream === true) {
    return reply
      .header('content-type', 'text/event-stream; charset=utf-8')
      .header('cache-control', 'no-cache')
      .header('connection', 'keep-alive')
      .send(toOpenAIStream(normalized));
  }
  return reply.send(normalized);
}

function defaultUpstream(config: TrueGateConfig): string {
  if (config.upstreamUrl) return config.upstreamUrl;
  switch (config.provider) {
    case 'cliproxy':
      return PROVIDER_BASE_URLS.cliproxy;
    case 'ollama':
      return PROVIDER_BASE_URLS.ollama;
    case 'lmstudio':
      return PROVIDER_BASE_URLS.lmstudio;
    case 'github-copilot':
      return PROVIDER_BASE_URLS['github-copilot'];
    default:
      return PROVIDER_BASE_URLS.openai;
  }
}

function pickAuthHeader(
  incoming: Record<string, string | string[] | undefined>,
  fallback: string | undefined,
): string | undefined {
  const v = incoming['authorization'];
  const flat = Array.isArray(v) ? v[0] : v;
  if (typeof flat === 'string' && flat.length > 0) return flat;
  if (fallback) return `Bearer ${fallback}`;
  return undefined;
}

export function registerChatCompletionsRoute(
  fastify: FastifyInstance,
  config: TrueGateConfig,
): void {
  // Anthropic provider uses translation, not passthrough.
  const anthropicTranslator =
    config.provider === 'anthropic' && config.anthropicApiKey
      ? new AnthropicProvider(
          config.anthropicApiKey,
          config.upstreamUrl ?? PROVIDER_BASE_URLS.anthropic,
        )
      : null;

  const base = defaultUpstream(config).replace(/\/$/, '').replace(/\/v1$/, '');
  const url = `${base}/v1/chat/completions`;
  const marker = resolveMarker(config);

  fastify.post<{ Body: ChatCompletionRequest }>(
    '/v1/chat/completions',
    async (request: FastifyRequest<{ Body: ChatCompletionRequest }>, reply) => {
      const context = request.governanceContext;
      const log = (level: 'warn' | 'info', msg: string) => {
        if (level === 'warn') fastify.log.warn(msg);
        else fastify.log.info(msg);
      };

      // Re-assert the agent_zero_envelope JSON contract on every relevant
      // request. The upstream model may have its own competing system prompt
      // (e.g. CLIProxyAPI's Claude Code session); this nudge has been
      // empirically necessary to keep tool-call output valid.
      const reinforcedBody = reinforceAgentZeroEnvelope(request.body);
      if (reinforcedBody !== request.body) {
        log('info', 'agent-zero envelope detected, reinforcement system message injected');
      }

      try {
        if (anthropicTranslator) {
          const response = await anthropicTranslator.complete(reinforcedBody);
          return sendChatCompletion(reply, response, reinforcedBody, context, marker, log);
        }

        const incoming = request.headers as Record<string, string | string[] | undefined>;
        const headers: Record<string, string> = { 'content-type': 'application/json' };

        // Forward GitHub-Copilot integration header verbatim if present
        const copilot = incoming['copilot-integration-id'];
        const copilotFlat = Array.isArray(copilot) ? copilot[0] : copilot;
        if (typeof copilotFlat === 'string') headers['copilot-integration-id'] = copilotFlat;

        // GitHub Copilot preset injects its own integration header from config
        if (config.provider === 'github-copilot') {
          headers['copilot-integration-id'] = 'vscode-chat';
          headers['editor-version'] = 'truegate/0.1.0';
        }

        const auth = pickAuthHeader(
          incoming,
          config.provider === 'github-copilot'
            ? (config.githubToken ?? config.upstreamApiKey)
            : (config.openAiApiKey ?? config.upstreamApiKey),
        );
        if (auth) headers['authorization'] = auth;

        const body = { ...reinforcedBody, stream: false };
        const res = await fetch(url, {
          method: 'POST',
          headers,
          body: JSON.stringify(body),
        });

        if (!res.ok) {
          const text = await res.text();
          throw new Error(`Provider API error ${res.status}: ${text}`);
        }

        const json = (await res.json()) as ChatCompletionResponse;
        return sendChatCompletion(reply, json, reinforcedBody, context, marker, log);
      } catch (err) {
        fastify.log.error(err, 'Provider error');
        return reply.status(502).send({
          error: {
            message: err instanceof Error ? err.message : 'Provider error',
            type: 'proxy_error',
          },
        });
      }
    },
  );
}
