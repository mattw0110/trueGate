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
import type { ChatCompletionRequest, ChatCompletionResponse } from '../../types/providers.js';
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

function normalizeAgentZeroEnvelope(
  response: ChatCompletionResponse,
  requestBody: ChatCompletionRequest,
): ChatCompletionResponse {
  if (!isAgentZeroEnvelopeRequest(requestBody)) return response;

  const firstChoice = response.choices[0];
  const content = firstChoice?.message?.content;
  if (typeof content !== 'string' || hasAgentZeroToolEnvelope(content)) return response;

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
) {
  // Apply governance + marker to the raw model text first, so it survives
  // both Agent Zero envelope wrapping and SSE stream serialization.
  const decorated = applyGovernanceAndMarker(response, context, marker);
  const normalized = normalizeAgentZeroEnvelope(decorated, requestBody);
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
      try {
        if (anthropicTranslator) {
          const response = await anthropicTranslator.complete(request.body);
          return sendChatCompletion(reply, response, request.body, context, marker);
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

        const body = { ...request.body, stream: false };
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
        return sendChatCompletion(reply, json, request.body, context, marker);
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
