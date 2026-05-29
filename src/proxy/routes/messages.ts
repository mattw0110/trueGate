import type { FastifyInstance } from 'fastify';
import { AnthropicPassthrough } from '../../providers/anthropic/anthropic-passthrough.js';
import { injectGovernanceIntoAnthropic } from '../../governance/compiler/anthropic-injector.js';
import {
  validateAnthropicResponse,
  extractAnthropicText,
} from '../../validators/engine/validate-anthropic-response.js';
import { shouldBlock } from '../../validators/engine/severity-handler.js';
import {
  formatWarnings,
  formatBlockedResponse,
} from '../../validators/reporting/warning-formatter.js';
import {
  resolveMarker,
  markerSuffix,
  formatMarker,
} from '../../validators/reporting/response-marker.js';
import { pickUpstreamForModel } from '../../registry/route-model.js';
import type { TrueGateConfig, UpstreamRegistry } from '../../types/runtime.js';
import type {
  AnthropicNativeRequest,
  AnthropicNativeResponse,
  AnthropicTextBlock,
  AnthropicContentBlock,
} from '../../types/anthropic.js';

/**
 * Append the trueGate marker to the LAST text block in the content array so
 * IDEs that render markdown see "— trueGate" on its own line below the
 * model's reply. If no text block exists (e.g. tool_use only), append a new
 * text block.
 */
function appendMarkerToContent(
  content: AnthropicContentBlock[],
  marker: string,
): AnthropicContentBlock[] {
  if (!marker) return content;
  const suffix = markerSuffix(marker);

  for (let i = content.length - 1; i >= 0; i--) {
    const block = content[i];
    if (block?.type === 'text' && typeof (block as { text?: unknown }).text === 'string') {
      const updated: AnthropicTextBlock = {
        ...(block as AnthropicTextBlock),
        text: (block as AnthropicTextBlock).text + suffix,
      };
      const next = [...content];
      next[i] = updated;
      return next;
    }
  }

  // No text block found — add one at the end
  return [...content, { type: 'text', text: marker } satisfies AnthropicTextBlock];
}

export function registerMessagesRoute(
  fastify: FastifyInstance,
  config: TrueGateConfig,
  registry: UpstreamRegistry,
): void {
  const baseMarker = resolveMarker(config);

  fastify.post<{ Body: AnthropicNativeRequest }>('/v1/messages', async (request, reply) => {
    const context = request.governanceContext;
    let body = request.body;

    if (context) {
      body = injectGovernanceIntoAnthropic(body, context, {
        stripClientSystem: config.stripClientSystem ?? false,
      });
    } else if (config.stripClientSystem) {
      const { system: _drop, ...rest } = body;
      body = rest as AnthropicNativeRequest;
    }

    const requestedModel = body.model ?? '';
    const { endpoint } = pickUpstreamForModel(requestedModel, registry, config);

    const passthrough = new AnthropicPassthrough(endpoint.baseUrl);
    let response: AnthropicNativeResponse;
    try {
      const passOpts: {
        forwardHeaders: Record<string, string | string[] | undefined>;
        apiKey?: string;
      } = {
        forwardHeaders: request.headers as Record<string, string | string[] | undefined>,
      };
      const key = endpoint.apiKey ?? config.anthropicApiKey;
      if (key !== undefined) passOpts.apiKey = key;
      response = await passthrough.messages(body, passOpts);
    } catch (err) {
      fastify.log.error(err, 'Anthropic passthrough error');
      return reply.status(502).send({
        type: 'error',
        error: {
          type: 'proxy_error',
          message: err instanceof Error ? err.message : 'Provider error',
        },
      });
    }

    const marker = formatMarker(baseMarker, endpoint.provider, response.model ?? requestedModel);

    if (!context) {
      return reply.send({
        ...response,
        content: appendMarkerToContent(response.content, marker),
      });
    }

    const result = validateAnthropicResponse(response, context.rules);

    if (shouldBlock(result)) {
      const blocked: AnthropicNativeResponse = {
        ...response,
        content: appendMarkerToContent(
          [{ type: 'text', text: formatBlockedResponse(result) } satisfies AnthropicTextBlock],
          marker,
        ),
        stop_reason: 'end_turn',
      };
      return reply.send(blocked);
    }

    if (result.severity === 'warn') {
      const original = extractAnthropicText(response);
      const warned: AnthropicNativeResponse = {
        ...response,
        content: appendMarkerToContent(
          [{ type: 'text', text: original + formatWarnings(result) } satisfies AnthropicTextBlock],
          marker,
        ),
      };
      return reply.send(warned);
    }

    return reply.send({
      ...response,
      content: appendMarkerToContent(response.content, marker),
    });
  });
}
