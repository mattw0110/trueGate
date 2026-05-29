import type { ProviderName } from '../types/runtime.js';

/**
 * Prefix-based hints used when no upstream advertises an exact model match.
 * Order within each list is preference order (first match wins amongst
 * reachable upstreams).
 *
 * These are deliberately conservative — only well-known model families that
 * map unambiguously to a provider. Anything not listed falls through to the
 * highest-priority reachable upstream.
 */
export const MODEL_PATTERNS: Array<{
  match: (model: string) => boolean;
  candidates: ProviderName[];
}> = [
  { match: (m) => /^claude/i.test(m), candidates: ['anthropic', 'cliproxy'] },
  { match: (m) => /^gpt-/i.test(m), candidates: ['openai', 'cliproxy', 'github-copilot'] },
  { match: (m) => /^o[0-9]/i.test(m), candidates: ['openai', 'cliproxy'] },
  { match: (m) => /^codex/i.test(m), candidates: ['openai', 'cliproxy'] },
  { match: (m) => /^gemini/i.test(m), candidates: ['cliproxy'] },
  { match: (m) => /^grok/i.test(m), candidates: ['cliproxy'] },
  {
    match: (m) => /^(llama|qwen|mistral|deepseek|phi|gemma)/i.test(m),
    candidates: ['ollama', 'lmstudio'],
  },
];

export function candidatesForModel(model: string): ProviderName[] {
  for (const pattern of MODEL_PATTERNS) {
    if (pattern.match(model)) return pattern.candidates;
  }
  return [];
}
