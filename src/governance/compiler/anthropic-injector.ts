import type { CompiledContext } from '../../types/governance.js';
import type { AnthropicNativeRequest, AnthropicTextBlock } from '../../types/anthropic.js';

export interface AnthropicInjectOptions {
  /**
   * Drop the client's `system` field entirely and inject only governance.
   * Use this for testing governance in isolation; it WILL break agent CLIs
   * (Claude Code, etc.) that rely on their baked-in system prompt.
   */
  stripClientSystem?: boolean;
}

export function injectGovernanceIntoAnthropic(
  req: AnthropicNativeRequest,
  context: CompiledContext,
  options: AnthropicInjectOptions = {},
): AnthropicNativeRequest {
  const governance = context.systemMessage.trim();

  if (options.stripClientSystem) {
    // Replace the client's system entirely. If we have no governance to add,
    // leave the field undefined so the upstream sees a "no system prompt"
    // request — that's the explicit intent of strip mode.
    if (!governance) {
      const { system: _drop, ...rest } = req;
      return rest;
    }
    return { ...req, system: governance };
  }

  if (!governance) return req;

  if (req.system === undefined) {
    return { ...req, system: governance };
  }

  if (typeof req.system === 'string') {
    return { ...req, system: `${req.system}\n\n${governance}` };
  }

  // Array form (cache_control etc.) — append our block at the end so the
  // client's cache prefix stays intact and stable.
  const govBlock: AnthropicTextBlock = { type: 'text', text: governance };
  return { ...req, system: [...req.system, govBlock] };
}
