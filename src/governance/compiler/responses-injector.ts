import type { CompiledContext } from '../../types/governance.js';
import type { ResponsesRequest } from '../../types/responses-api.js';

export interface ResponsesInjectOptions {
  stripClientSystem?: boolean;
}

export function injectGovernanceIntoResponses(
  req: ResponsesRequest,
  context: CompiledContext,
  options: ResponsesInjectOptions = {},
): ResponsesRequest {
  const governance = context.systemMessage.trim();

  if (options.stripClientSystem) {
    if (!governance) {
      const { instructions: _drop, ...rest } = req;
      return rest;
    }
    return { ...req, instructions: governance };
  }

  if (!governance) return req;

  if (req.instructions === undefined) {
    return { ...req, instructions: governance };
  }

  return { ...req, instructions: `${req.instructions}\n\n${governance}` };
}
