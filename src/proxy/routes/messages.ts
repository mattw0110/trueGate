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
  formatOverrideNotice,
} from '../../validators/reporting/warning-formatter.js';
import {
  resolveMarker,
  markerSuffix,
  formatMarker,
  governanceNote,
} from '../../validators/reporting/response-marker.js';
import { pickUpstreamForModel } from '../../registry/route-model.js';
import { consumeApprovedBlockOverride, createBlockOverrideUrl } from '../block-override.js';
import { logGovernanceDecision } from '../../governance/events/logger.js';
import type { TrueGateConfig, UpstreamRegistry } from '../../types/runtime.js';
import type {
  AnthropicNativeRequest,
  AnthropicNativeResponse,
  AnthropicTextBlock,
  AnthropicContentBlock,
} from '../../types/anthropic.js';

function contentText(content: AnthropicNativeRequest['messages'][number]['content']): string {
  if (typeof content === 'string') return content;
  return content
    .map((block) => (block.type === 'text' && 'text' in block ? block.text : ''))
    .filter(Boolean)
    .join('\n');
}

function anthropicRequestText(body: AnthropicNativeRequest): string {
  const system =
    typeof body.system === 'string'
      ? body.system
      : body.system?.map((block) => block.text).join('\n') ?? '';
  return [system, ...body.messages.map((message) => contentText(message.content))]
    .filter(Boolean)
    .join('\n\n');
}

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
      const injectOptions: Parameters<typeof injectGovernanceIntoAnthropic>[2] = {
        stripClientSystem: config.stripClientSystem ?? false,
      };
      if (config.policyMode !== undefined) injectOptions.policyMode = config.policyMode;
      injectOptions.sourceText = anthropicRequestText(body);
      body = injectGovernanceIntoAnthropic(body, context, injectOptions);
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
    reply.header('x-truegate-upstream', `${endpoint.provider}/${response.model ?? requestedModel}`);

    if (!context) {
      const note = governanceNote(marker, false, undefined);
      const fullMarker = note ? `${marker}\n${note}` : marker;
      return reply.send({
        ...response,
        content: appendMarkerToContent(response.content, fullMarker),
      });
    }

    const result = validateAnthropicResponse(response, context.rules);
    const logDecision = (decision: 'pass' | 'warn' | 'block' | 'override_allowed') => {
      logGovernanceDecision({
        decision,
        route: '/v1/messages',
        result,
        provider: endpoint.provider,
        model: response.model ?? requestedModel,
        client: 'anthropic',
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
        const overridden: AnthropicNativeResponse = {
          ...response,
          content: appendMarkerToContent(
            [
              {
                type: 'text',
                text: extractAnthropicText(response) + formatOverrideNotice(result),
              } satisfies AnthropicTextBlock,
            ],
            overrideMarker,
          ),
        };
        return reply.send(overridden);
      }
      logDecision('block');
      const overrideUrl = createBlockOverrideUrl(request);
      const blocked: AnthropicNativeResponse = {
        ...response,
        content: appendMarkerToContent(
          [
            {
              type: 'text',
              text: formatBlockedResponse(result, overrideUrl),
            } satisfies AnthropicTextBlock,
          ],
          marker,
        ),
        stop_reason: 'end_turn',
      };
      return reply.send(blocked);
    }

    if (result.severity === 'warn') {
      logDecision('warn');
      const original = extractAnthropicText(response);
      const warnNote = governanceNote(
        marker,
        true,
        'warn',
        withGovernanceTrace(context, { issues: result.issues }),
      );
      const warnMarker = warnNote ? `${marker}\n${warnNote}` : marker;
      const warned: AnthropicNativeResponse = {
        ...response,
        content: appendMarkerToContent(
          [{ type: 'text', text: original + formatWarnings(result) } satisfies AnthropicTextBlock],
          warnMarker,
        ),
      };
      return reply.send(warned);
    }

    logDecision('pass');
    const note = governanceNote(
      marker,
      true,
      'pass',
      withGovernanceTrace(context, { ruleCount: context.rules.dangerousPatterns.length }),
    );
    const fullMarker = note ? `${marker}\n${note}` : marker;
    return reply.send({
      ...response,
      content: appendMarkerToContent(response.content, fullMarker),
    });
  });
}
