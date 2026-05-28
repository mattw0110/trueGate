import { validateResponse } from './validate-response.js';
import type { ValidationResult } from '../../types/validation.js';
import type { RuleSet } from '../../types/governance.js';
import type { ResponsesResponse } from '../../types/responses-api.js';

export function extractResponsesText(response: ResponsesResponse): string {
  const parts: string[] = [];

  if (typeof response.output_text === 'string' && response.output_text.length > 0) {
    parts.push(response.output_text);
  }

  for (const item of response.output ?? []) {
    if (item.type === 'message' && item.content) {
      for (const piece of item.content) {
        if (typeof piece.text === 'string') parts.push(piece.text);
      }
      continue;
    }

    // function_call / tool_call shape: { type: 'function_call', name, arguments: '<json string>' }
    if (item.type === 'function_call' || item.type === 'tool_call' || item.type === 'function') {
      const args = (item as { arguments?: unknown }).arguments;
      if (typeof args === 'string') parts.push(args);
      continue;
    }
  }

  return parts.join('\n');
}

export function validateResponsesResponse(
  response: ResponsesResponse,
  rules: RuleSet,
): ValidationResult {
  return validateResponse(extractResponsesText(response), rules);
}
