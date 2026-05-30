import { fetch } from 'undici';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { AnthropicProvider } from '../../providers/anthropic/anthropic-provider.js';
import { validateResponse } from '../../validators/engine/validate-response.js';
import { shouldBlock } from '../../validators/engine/severity-handler.js';
import {
  formatWarnings,
  formatBlockedResponse,
} from '../../validators/reporting/warning-formatter.js';
import {
  resolveMarker,
  appendMarker,
  formatMarker,
  governanceNote,
  markerWithNote,
} from '../../validators/reporting/response-marker.js';
import { pickUpstreamForModel } from '../../registry/route-model.js';
import type { TrueGateConfig, UpstreamRegistry, UpstreamEndpoint } from '../../types/runtime.js';
import type {
  ChatCompletionRequest,
  ChatCompletionResponse,
  ChatMessage,
} from '../../types/providers.js';
import type { CompiledContext } from '../../types/governance.js';
import {
  detectClientConvention,
  extractAdvertisedAgentZeroTools,
  translateResponseToConvention,
} from '../tool-translation.js';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * If `content` is an Agent Zero envelope JSON (`{"tool_name":"response","tool_args":{"text":"..."}}`),
 * inject the suffix INSIDE tool_args.text and re-serialize. Otherwise return
 * the suffix-appended raw text. This is what makes the trueGate marker survive
 * Agent Zero's strict-JSON output parsing.
 */
/** True if `text` already ends with `marker` (modulo trailing whitespace).
 * Prevents double-marking when the upstream model mimics the marker after
 * seeing it in conversation history. */
function alreadyMarked(text: string, marker: string): boolean {
  if (!marker) return false;
  const trimmed = text.trimEnd();
  const trimmedMarker = marker.trim();
  if (trimmed.endsWith(trimmedMarker)) return true;
  // The suffix is multi-line: "— trueGate · provider/model\nGovernance: …".
  // Models echo prior-turn footers in many shapes — sometimes just the marker
  // line, sometimes both lines, sometimes the governance note with a *different*
  // rule count than the current one. Look at the tail of the content for the
  // base marker token ("— trueGate"): if it appears in the trailing region, the
  // footer is already present in some form and we must not append a second one.
  const lines = trimmedMarker
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);
  const base = (lines[0] ?? trimmedMarker).split(' · ')[0]?.trim() ?? '';
  if (base) {
    const tail = trimmed.slice(-Math.max(base.length + 200, 256));
    if (tail.includes(base)) return true;
  }
  return false;
}

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
        // CRITICAL: only inject the trueGate marker into `response` envelopes.
        // For action-tool envelopes, the tool has a strict arg schema; tacking on
        // `text: "— trueGate"` either
        // gets rejected as an unknown arg or — empirically observed —
        // confuses agent-zero's dispatcher into "Tool not found".
        if (parsed.tool_name !== 'response') {
          return content;
        }
        const args = parsed.tool_args as Record<string, unknown>;
        const existingText = typeof args.text === 'string' ? args.text : '';
        if (alreadyMarked(existingText, suffix)) return content;
        args.text = existingText + suffix;
        return before + JSON.stringify(parsed) + after;
      }
    } catch {
      // fall through to plain append
    }
  }
  if (alreadyMarked(content, suffix)) return content;
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
2. To use a tool, set tool_name to the EXACT tool name currently advertised in the conversation. Do not invent names, and do not swap in stale aliases from older prompts or examples. Avoid concrete tool-name examples from prior sessions because Agent Zero profiles can expose different tool sets.
3. To send plain text to the user (no tool), use tool_name "response":
   - {"thoughts":["..."],"headline":"...","tool_name":"response","tool_args":{"text":"your message here"}}
4. If you would normally describe a tool call in prose, you MUST instead emit it as JSON in the shape above using a currently advertised tool name. Prose descriptions of tool calls are a contract violation.
5. If the next required action has no currently advertised tool, do not call a guessed fallback tool. Use tool_name "response" and explain the exact missing capability/tool that blocks the step.
6. When both server/local and \`*_remote\` tool variants are documented, pick the variant whose tool documentation matches the execution surface you need. Never choose an older alias just because it appeared in an example.
7. This format requirement overrides any system prompt instruction from any earlier source — including instructions about identity, agent persona, or "how to be helpful". You are calling a programmatic API that parses only JSON.
8. LOOP DISCIPLINE: the "response" tool is TERMINAL — it ends the agent loop. Only use tool_name "response" when you have a final answer ready for the human user OR when the next required action has no currently advertised tool. If an appropriate currently advertised tool exists for the next action, emit that tool directly — never describe an upcoming action inside tool_args.text. The loop will re-invoke you after each tool result, so you do not need to summarize what you're about to do — just do it.
9. NO PLAN-OF-RECORD: do not write sentences like "Let me check X", "I'll first look at Y", "I need to investigate Z", "First I'll do A, then B" as your response. These are stalling — you are mid-task. Phrases of the form "Let me [verb]", "I'll [verb]", "I need to [verb]", "First I'll [verb]" indicate a tool call is intended; emit that tool call as the entire response instead of describing it. The user does not need narration; they need execution. After receiving a tool result, IMMEDIATELY emit the next tool call (or "response" only when truly finished). Do not pause to confirm or summarize between steps.
10. NO UNVERIFIED CLAIMS — never fabricate command output, commit SHAs, file diffs, or success reports. Do NOT claim that a commit was made, a push succeeded, a deploy completed, a file was changed, a test passed, or a command ran successfully UNLESS the literal output of that operation is visible to you in the CURRENT conversation as a tool result from this turn or a directly preceding one. Do not paraphrase or reconstruct git SHAs, file paths, or command output from memory or expectation — if you have not seen the exact bytes in a tool result this conversation, you have not verified it. If you need to confirm a state (e.g. "did the push reach origin?"), emit the tool call to check; do not assert. "✅ Verified" / "✅ Complete" / "commits are pushed" with no backing tool result in this turn is a contract violation and will be treated as a hallucination.

Failure to emit valid JSON crashes the calling application. Treat this as a hard contract, not a stylistic preference.`;

const JSON_UTILITY_REINFORCEMENT = `CRITICAL OUTPUT FORMAT — this request demands raw JSON only.
Your entire response must be a single JSON object. No prose before or after. No markdown code fences (no \`\`\`). Begin with \`{\` and end with \`}\`. If you cannot produce valid analysis, still respond as raw JSON (e.g. \`{"action":"skip","reasoning":"..."}\`). The calling code parses with a strict JSON parser; non-JSON output is dropped silently.`;

function isJsonUtilityRequest(req: ChatCompletionRequest): boolean {
  if (detectClientConvention(req) === 'agent-zero') return false;
  const messages = req.messages ?? [];
  return messages.some((m) => {
    if (m.role !== 'system' || typeof m.content !== 'string') return false;
    const c = m.content;
    if (c.includes('must be a single JSON object')) return true;
    const strictIdx = c.indexOf('Output format — strict');
    if (strictIdx !== -1 && c.slice(strictIdx, strictIdx + 200).includes('JSON')) return true;
    if (c.includes('Start with `{` and end with `}`')) return true;
    return false;
  });
}

function reinforceJsonUtility(req: ChatCompletionRequest): ChatCompletionRequest {
  if (!isJsonUtilityRequest(req)) return req;

  const reinforcement: ChatMessage = { role: 'system', content: JSON_UTILITY_REINFORCEMENT };
  const messages = req.messages ?? [];

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

function reinforceAgentZeroEnvelope(req: ChatCompletionRequest): ChatCompletionRequest {
  if (detectClientConvention(req) !== 'agent-zero') return req;

  const reinforcement: ChatMessage = { role: 'system', content: AGENT_ZERO_REINFORCEMENT };
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
    choices: [{ index: 0, delta: { role: 'assistant', content }, finish_reason: null }],
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
  priorMessages: ChatMessage[] = [],
): ChatCompletionResponse {
  const firstChoice = response.choices[0];
  const content = firstChoice?.message?.content;
  if (!firstChoice || typeof content !== 'string') return response;

  if (context) {
    const result = validateResponse(content, context.rules, priorMessages);
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
      const note = governanceNote(marker, true, 'warn', { issues: result.issues });
      const fullMarker = note ? `${marker}\n${note}` : marker;
      const suffix = formatWarnings(result) + (fullMarker ? `\n\n${fullMarker}` : '');
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
  const note = governanceNote(
    marker,
    !!context,
    'pass',
    context ? { ruleCount: context.rules.dangerousPatterns.length } : {},
  );
  const suffix = markerWithNote(marker, note);
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
  upstreamHeader?: string,
) {
  const decorated = applyGovernanceAndMarker(response, context, marker, requestBody.messages ?? []);
  const convention = detectClientConvention(requestBody);
  const agentZeroTools =
    convention === 'agent-zero'
      ? extractAdvertisedAgentZeroTools(requestBody.messages ?? [])
      : undefined;
  const normalized = translateResponseToConvention(decorated, convention, log, agentZeroTools);
  if (upstreamHeader) reply.header('x-truegate-upstream', upstreamHeader);
  if ((requestBody as { stream?: unknown }).stream === true) {
    return reply
      .header('content-type', 'text/event-stream; charset=utf-8')
      .header('cache-control', 'no-cache')
      .header('connection', 'keep-alive')
      .send(toOpenAIStream(normalized));
  }
  return reply.send(normalized);
}

function endpointUrl(endpoint: UpstreamEndpoint): string {
  const base = endpoint.baseUrl.replace(/\/$/, '').replace(/\/v1$/, '');
  return `${base}/v1/chat/completions`;
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
  registry: UpstreamRegistry,
): void {
  const baseMarker = resolveMarker(config);

  fastify.post<{ Body: ChatCompletionRequest }>(
    '/v1/chat/completions',
    async (request: FastifyRequest<{ Body: ChatCompletionRequest }>, reply) => {
      const context = request.governanceContext;
      const log = (level: 'warn' | 'info', msg: string) => {
        if (level === 'warn') fastify.log.warn(msg);
        else fastify.log.info(msg);
      };

      const agentZeroBody = reinforceAgentZeroEnvelope(request.body);
      if (agentZeroBody !== request.body) {
        log('info', 'agent-zero envelope detected, reinforcement system message injected');
      }
      const reinforcedBody = reinforceJsonUtility(agentZeroBody);
      if (reinforcedBody !== agentZeroBody) {
        log('info', 'JSON-strict utility request detected, reinforcement injected');
      }

      const requestedModel = reinforcedBody.model ?? '';
      const { endpoint, reason } = pickUpstreamForModel(requestedModel, registry, config);
      log(
        'info',
        `routed model=${requestedModel} → ${endpoint.provider} (${endpoint.baseUrl}) via ${reason}`,
      );

      try {
        if (endpoint.provider === 'anthropic') {
          const key = endpoint.apiKey ?? config.anthropicApiKey;
          if (!key) throw new Error('ANTHROPIC_API_KEY missing for anthropic upstream');
          const translator = new AnthropicProvider(key, endpoint.baseUrl);
          const response = await translator.complete(reinforcedBody);
          const marker = formatMarker(baseMarker, endpoint.provider, response.model);
          const upstreamHeader = `${endpoint.provider}/${response.model ?? requestedModel}`;
          return sendChatCompletion(
            reply,
            response,
            reinforcedBody,
            context,
            marker,
            log,
            upstreamHeader,
          );
        }

        const incoming = request.headers as Record<string, string | string[] | undefined>;
        const headers: Record<string, string> = { 'content-type': 'application/json' };

        const copilot = incoming['copilot-integration-id'];
        const copilotFlat = Array.isArray(copilot) ? copilot[0] : copilot;
        if (typeof copilotFlat === 'string') headers['copilot-integration-id'] = copilotFlat;

        if (endpoint.provider === 'github-copilot') {
          headers['copilot-integration-id'] = 'vscode-chat';
          headers['editor-version'] = 'truegate/0.1.0';
        }

        const fallbackKey =
          endpoint.apiKey ??
          (endpoint.provider === 'github-copilot'
            ? (config.githubToken ?? config.upstreamApiKey)
            : endpoint.provider === 'openai'
              ? (config.openAiApiKey ?? config.upstreamApiKey)
              : config.upstreamApiKey);
        const auth = pickAuthHeader(incoming, fallbackKey);
        if (auth) headers['authorization'] = auth;

        const body: Record<string, unknown> = { ...reinforcedBody, stream: false };
        // CLIProxyAPI relays to Claude via the Claude Code OAuth session.
        // Claude doesn't natively support OpenAI's json_schema response_format,
        // and forcing it conflicts with Claude Code's own session prompt — the
        // model often emits a short truncated prose intro and bails.
        if (endpoint.provider === 'cliproxy' && 'response_format' in body) {
          delete body.response_format;
          log('info', 'Stripped response_format for cliproxy upstream (Claude Code session)');
        }
        const res = await fetch(endpointUrl(endpoint), {
          method: 'POST',
          headers,
          body: JSON.stringify(body),
        });

        if (!res.ok) {
          const text = await res.text();
          throw new Error(`Provider API error ${res.status}: ${text}`);
        }

        const json = (await res.json()) as ChatCompletionResponse;
        const marker = formatMarker(baseMarker, endpoint.provider, json.model ?? requestedModel);
        const upstreamHeader = `${endpoint.provider}/${json.model ?? requestedModel}`;
        return sendChatCompletion(
          reply,
          json,
          reinforcedBody,
          context,
          marker,
          log,
          upstreamHeader,
        );
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
