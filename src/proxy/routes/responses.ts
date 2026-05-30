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
} from '../../validators/reporting/warning-formatter.js';
import {
  resolveMarker,
  markerSuffix,
  appendMarker,
  formatMarker,
  governanceNote,
} from '../../validators/reporting/response-marker.js';
import { pickUpstreamForModel } from '../../registry/route-model.js';
import type { TrueGateConfig, UpstreamRegistry } from '../../types/runtime.js';
import type {
  ResponsesRequest,
  ResponsesResponse,
  ResponsesOutputItem,
} from '../../types/responses-api.js';

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
      body = injectGovernanceIntoResponses(body, context, {
        stripClientSystem: config.stripClientSystem ?? false,
      });
    } else if (config.stripClientSystem) {
      const { instructions: _drop, ...rest } = body;
      body = rest as ResponsesRequest;
    }

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
      context ? { ruleCount: context.rules.dangerousPatterns.length } : {},
    );
    const fullMarker = note ? `${marker}\n${note}` : marker;

    if (!context) {
      return reply.send(applyMarkerToResponse(upstreamResponse, fullMarker));
    }

    const result = validateResponsesResponse(upstreamResponse, context.rules);

    if (shouldBlock(result)) {
      const blockText = appendMarker(formatBlockedResponse(result), marker);
      const blockedOutput: ResponsesOutputItem = {
        type: 'message',
        role: 'assistant',
        content: [{ type: 'output_text', text: blockText }],
      };
      return reply.send({ ...upstreamResponse, output: [blockedOutput], output_text: blockText });
    }

    if (result.severity === 'warn') {
      const warnNote = governanceNote(marker, true, 'warn', { issues: result.issues });
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

    return reply.send(applyMarkerToResponse(upstreamResponse, fullMarker));
  });
}
