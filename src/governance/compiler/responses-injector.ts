import type { CompiledContext } from '../../types/governance.js';
import type { ResponsesRequest } from '../../types/responses-api.js';
import type { PolicyMode } from '../../types/runtime.js';
import { governancePromptForMode } from './policy-mode.js';

export interface ResponsesInjectOptions {
  stripClientSystem?: boolean;
  policyMode?: PolicyMode;
  sourceText?: string;
}

export function injectGovernanceIntoResponses(
  req: ResponsesRequest,
  context: CompiledContext,
  options: ResponsesInjectOptions = {},
): ResponsesRequest {
  const governance = governancePromptForMode(context, options.policyMode, options.sourceText);

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
