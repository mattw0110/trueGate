import { validateResponse } from './validate-response.js';
import type { ValidationResult } from '../../types/validation.js';
import type { RuleSet } from '../../types/governance.js';
import type { AnthropicNativeResponse, AnthropicContentBlock } from '../../types/anthropic.js';

// Recursively extract every string from an arbitrary JSON value. Used to scan
// tool_use.input — the model might emit a dangerous shell command as a string
// field inside structured tool arguments.
function extractStrings(value: unknown, out: string[]): void {
  if (typeof value === 'string') {
    out.push(value);
    return;
  }
  if (Array.isArray(value)) {
    for (const v of value) extractStrings(v, out);
    return;
  }
  if (value && typeof value === 'object') {
    for (const v of Object.values(value as Record<string, unknown>)) {
      extractStrings(v, out);
    }
  }
}

export function extractAnthropicText(response: AnthropicNativeResponse): string {
  const parts: string[] = [];

  for (const block of response.content) {
    const b = block as AnthropicContentBlock & {
      text?: unknown;
      input?: unknown;
    };

    if (block.type === 'text' && typeof b.text === 'string') {
      parts.push(b.text);
      continue;
    }

    if (block.type === 'tool_use') {
      // The model is calling a tool — scan every string in the tool's input.
      extractStrings(b.input, parts);
      continue;
    }

    // Unknown block shape — best effort: recursively extract any strings so we
    // don't silently miss future Anthropic block types.
    extractStrings(b, parts);
  }

  return parts.join('\n');
}

export function validateAnthropicResponse(
  response: AnthropicNativeResponse,
  rules: RuleSet,
): ValidationResult {
  return validateResponse(extractAnthropicText(response), rules);
}
