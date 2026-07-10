import { fetch } from 'undici';
import type { FastifyInstance } from 'fastify';
import { injectGovernanceIntoResponses } from '../../governance/compiler/responses-injector.js';
import {
  validateResponsesResponse,
  extractResponsesText,
} from '../../validators/engine/validate-responses-response.js';
import { shouldBlock } from '../../validators/engine/severity-handler.js';
import {
  formatWarnings,
  formatBlockedResponse,
  formatOverrideNotice,
} from '../../validators/reporting/warning-formatter.js';
import {
  resolveMarker,
  markerSuffix,
  appendMarker,
  formatMarker,
  governanceNote,
} from '../../validators/reporting/response-marker.js';
import { pickUpstreamForModel } from '../../registry/route-model.js';
import { consumeApprovedBlockOverride, createBlockOverrideUrl } from '../block-override.js';
import { logGovernanceDecision } from '../../governance/events/logger.js';
import type { TrueGateConfig, UpstreamRegistry } from '../../types/runtime.js';
import type {
  ResponsesRequest,
  ResponsesResponse,
  ResponsesOutputItem,
} from '../../types/responses-api.js';

function responsesInputText(input: ResponsesRequest['input']): string {
  if (typeof input === 'string') return input;
  if (!Array.isArray(input)) return '';
  return input
    .map((message) => {
      if (typeof message.content === 'string') return message.content;
      return message.content
        .map((part) => ('text' in part && typeof part.text === 'string' ? part.text : ''))
        .filter(Boolean)
        .join('\n');
    })
    .filter(Boolean)
    .join('\n\n');
}

function responsesRequestText(body: ResponsesRequest): string {
  return [body.instructions ?? '', responsesInputText(body.input)].filter(Boolean).join('\n\n');
}

function isRoleMessage(value: unknown): value is { role: string; [key: string]: unknown } {
  return (
    typeof value === 'object' &&
    value !== null &&
    'role' in value &&
    typeof (value as { role?: unknown }).role === 'string'
  );
}

function systemMessagesBeforeAssistant<T extends { role: string }>(messages: T[]): T[] {
  const firstAssistant = messages.findIndex((message) => message.role === 'assistant');
  if (firstAssistant === -1) return messages;

  const lateSystemMessages = messages
    .slice(firstAssistant + 1)
    .filter((message) => message.role === 'system');
  if (lateSystemMessages.length === 0) return messages;

  const withoutLateSystemMessages = messages.filter(
    (message, index) => index <= firstAssistant || message.role !== 'system',
  );
  return [
    ...withoutLateSystemMessages.slice(0, firstAssistant),
    ...lateSystemMessages,
    ...withoutLateSystemMessages.slice(firstAssistant),
  ];
}

function normalizeResponsesSystemMessageOrder(req: ResponsesRequest): ResponsesRequest {
  let next: ResponsesRequest = req;

  const unknownBody = req as ResponsesRequest & { messages?: unknown };
  if (Array.isArray(unknownBody.messages) && unknownBody.messages.every(isRoleMessage)) {
    const messages = systemMessagesBeforeAssistant(unknownBody.messages);
    if (messages !== unknownBody.messages) next = { ...next, messages };
  }

  if (Array.isArray(next.input) && next.input.every(isRoleMessage)) {
    const input = systemMessagesBeforeAssistant(next.input);
    if (input !== next.input) next = { ...next, input };
  }

  return next;
}

function applyMarkerToResponse(resp: ResponsesResponse, marker: string): ResponsesResponse {
  if (!marker) return resp;
  const suffix = markerSuffix(marker);

  const newOutputText =
    typeof resp.output_text === 'string' ? resp.output_text + suffix : undefined;

  const newOutput = (resp.output ?? []).map((item) => {
    if (item.type !== 'message' || !item.content) return item;
    const lastIdx = (() => {
      for (let i = item.content.length - 1; i >= 0; i--) {
        if (typeof item.content[i]?.text === 'string') return i;
      }
      return -1;
    })();
    if (lastIdx === -1) return item;
    const newContent = [...item.content];
    const lastPiece = newContent[lastIdx];
    if (lastPiece && typeof lastPiece.text === 'string') {
      newContent[lastIdx] = { ...lastPiece, text: lastPiece.text + suffix };
    }
    return { ...item, content: newContent };
  });

  const out: ResponsesResponse = { ...resp, output: newOutput };
  if (newOutputText !== undefined) out.output_text = newOutputText;
  return out;
}

function governanceTraceLabel(context: { trace?: { bundleSource: string; governanceHash?: string } } | undefined): string | undefined {
  const trace = context?.trace;
  if (!trace) return undefined;
  return `${trace.bundleSource}#${trace.governanceHash ?? 'no-md'}`;
}

function withGovernanceTrace<T extends Record<string, unknown>>(
  context: { trace?: { bundleSource: string; governanceHash?: string } } | undefined,
  detail: T,
): T & { bundleSource?: string } {
  const label = governanceTraceLabel(context);
  return label ? { ...detail, bundleSource: label } : detail;
}

export function registerResponsesRoute(
  fastify: FastifyInstance,
  config: TrueGateConfig,
  registry: UpstreamRegistry,
): void {
  const baseMarker = resolveMarker(config);

  fastify.post<{ Body: ResponsesRequest }>('/v1/responses', async (request, reply) => {
    const requestedModel = (request.body as { model?: string }).model ?? '';
    const { endpoint } = pickUpstreamForModel(requestedModel, registry, config);
    const base = endpoint.baseUrl.replace(/\/$/, '').replace(/\/v1$/, '');
    const url = `${base}/v1/responses`;
    const marker = formatMarker(baseMarker, endpoint.provider, requestedModel);
    reply.header('x-truegate-upstream', `${endpoint.provider}/${requestedModel}`);
    const context = request.governanceContext;
    let body = request.body;

    if (context) {
      const injectOptions: Parameters<typeof injectGovernanceIntoResponses>[2] = {
        stripClientSystem: config.stripClientSystem ?? false,
      };
      if (config.policyMode !== undefined) injectOptions.policyMode = config.policyMode;
      injectOptions.sourceText = responsesRequestText(body);
      body = injectGovernanceIntoResponses(body, context, injectOptions);
    } else if (config.stripClientSystem) {
      const { instructions: _drop, ...rest } = body;
      body = rest as ResponsesRequest;
    }
    body = normalizeResponsesSystemMessageOrder(body);

    // Forward client headers (auth) verbatim; strip hop-by-hop noise.
    const headers: Record<string, string> = { 'content-type': 'application/json' };
    const incoming = request.headers as Record<string, string | string[] | undefined>;
    for (const name of [
      'authorization',
      'openai-organization',
      'openai-project',
      'openai-beta',
      'x-api-key',
    ]) {
      const v = incoming[name];
      const flat = Array.isArray(v) ? v[0] : v;
      if (typeof flat === 'string') headers[name] = flat;
    }

    let upstreamResponse: ResponsesResponse;
    try {
      const fetchBody = { ...body, stream: false };
      const res = await fetch(url, {
        method: 'POST',
        headers,
        body: JSON.stringify(fetchBody),
      });
      if (!res.ok) {
        const text = await res.text();
        throw new Error(`Responses API error ${res.status}: ${text}`);
      }
      upstreamResponse = (await res.json()) as ResponsesResponse;
    } catch (err) {
      fastify.log.error(err, 'Responses passthrough error');
      return reply.status(502).send({
        error: {
          type: 'proxy_error',
          message: err instanceof Error ? err.message : 'Provider error',
        },
      });
    }

    const note = governanceNote(
      marker,
      !!context,
      context ? 'pass' : undefined,
      context
        ? withGovernanceTrace(context, {
            ruleCount: context.rules.dangerousPatterns.length,
          })
        : {},
    );
    const fullMarker = note ? `${marker}\n${note}` : marker;

    if (!context) {
      return reply.send(applyMarkerToResponse(upstreamResponse, fullMarker));
    }

    const result = validateResponsesResponse(upstreamResponse, context.rules);
    const logDecision = (decision: 'pass' | 'warn' | 'block' | 'override_allowed') => {
      logGovernanceDecision({
        decision,
        route: '/v1/responses',
        result,
        provider: endpoint.provider,
        model: requestedModel,
        client: 'responses',
        statusCode: 200,
        overrideOffered: decision === 'block',
        overrideUsed: decision === 'override_allowed',
        ...(context.trace ? { governance: context.trace } : {}),
      }).catch((err) => fastify.log.warn({ err }, 'governance log write failed'));
    };

    if (shouldBlock(result)) {
      if (consumeApprovedBlockOverride()) {
        logDecision('override_allowed');
        const overrideNote = governanceNote(
          marker,
          true,
          'warn',
          withGovernanceTrace(context, { issues: result.issues }),
        );
        const overrideMarker = overrideNote ? `${marker}\n${overrideNote}` : marker;
        const overriddenText = appendMarker(
          extractResponsesText(upstreamResponse) + formatOverrideNotice(result),
          overrideMarker,
        );
        const overriddenOutput: ResponsesOutputItem = {
          type: 'message',
          role: 'assistant',
          content: [{ type: 'output_text', text: overriddenText }],
        };
        return reply.send({
          ...upstreamResponse,
          output: [overriddenOutput],
          output_text: overriddenText,
        });
      }
      logDecision('block');
      const overrideUrl = createBlockOverrideUrl(request);
      const blockText = appendMarker(formatBlockedResponse(result, overrideUrl), marker);
      const blockedOutput: ResponsesOutputItem = {
        type: 'message',
        role: 'assistant',
        content: [{ type: 'output_text', text: blockText }],
      };
      return reply.send({ ...upstreamResponse, output: [blockedOutput], output_text: blockText });
    }

    if (result.severity === 'warn') {
      logDecision('warn');
      const warnNote = governanceNote(
        marker,
        true,
        'warn',
        withGovernanceTrace(context, { issues: result.issues }),
      );
      const warnMarker = warnNote ? `${marker}\n${warnNote}` : marker;
      const original = extractResponsesText(upstreamResponse);
      const warnedText = appendMarker(original + formatWarnings(result), warnMarker);
      const warnedOutput: ResponsesOutputItem = {
        type: 'message',
        role: 'assistant',
        content: [{ type: 'output_text', text: warnedText }],
      };
      return reply.send({ ...upstreamResponse, output: [warnedOutput], output_text: warnedText });
    }

    logDecision('pass');
    return reply.send(applyMarkerToResponse(upstreamResponse, fullMarker));
  });
}
