import type { FastifyRequest, FastifyReply } from 'fastify';
import { validateResponse } from '../../validators/engine/validate-response.js';
import { shouldBlock } from '../../validators/engine/severity-handler.js';
import {
  formatWarnings,
  formatBlockedResponse,
} from '../../validators/reporting/warning-formatter.js';
import { resolveMarker, appendMarker } from '../../validators/reporting/response-marker.js';
import type { ChatCompletionResponse } from '../../types/providers.js';
import type { TrueGateConfig } from '../../types/runtime.js';

export function makeResponseValidatorHook(config: TrueGateConfig) {
  const marker = resolveMarker(config);

  return function responseValidatorHook(
    request: FastifyRequest,
    _reply: FastifyReply,
    payload: unknown,
    done: (err: Error | null, payload?: unknown) => void,
  ): void {
    // Only operate on /v1/chat/completions — the other routes apply the marker
    // themselves with route-specific shape knowledge.
    if (request.url !== '/v1/chat/completions') {
      done(null, payload);
      return;
    }

    const context = request.governanceContext;

    let parsed: ChatCompletionResponse;
    try {
      parsed =
        typeof payload === 'string'
          ? (JSON.parse(payload) as ChatCompletionResponse)
          : (payload as ChatCompletionResponse);
    } catch {
      done(null, payload);
      return;
    }

    const firstChoice = parsed?.choices?.[0];
    if (!firstChoice?.message?.content) {
      done(null, payload);
      return;
    }

    const content = firstChoice.message.content;
    const result = context
      ? validateResponse(content, context.rules)
      : { severity: 'pass' as const, issues: [], blocked: false };

    if (context && shouldBlock(result)) {
      const blockedText = appendMarker(formatBlockedResponse(result), marker);
      const blocked: ChatCompletionResponse = {
        ...parsed,
        choices: [
          {
            ...firstChoice,
            message: { role: 'assistant', content: blockedText },
            finish_reason: 'stop',
          },
        ],
      };
      done(null, JSON.stringify(blocked));
      return;
    }

    if (context && result.severity === 'warn') {
      const warnedText = appendMarker(content + formatWarnings(result), marker);
      const warned: ChatCompletionResponse = {
        ...parsed,
        choices: [
          {
            ...firstChoice,
            message: { role: 'assistant', content: warnedText },
          },
        ],
      };
      done(null, JSON.stringify(warned));
      return;
    }

    // Pass-through case: still append the marker
    if (marker) {
      const decorated: ChatCompletionResponse = {
        ...parsed,
        choices: [
          {
            ...firstChoice,
            message: { role: 'assistant', content: appendMarker(content, marker) },
          },
        ],
      };
      done(null, JSON.stringify(decorated));
      return;
    }

    done(null, payload);
  };
}
