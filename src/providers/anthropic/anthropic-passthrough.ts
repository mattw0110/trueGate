import { fetch } from 'undici';
import { ANTHROPIC_VERSION, PROVIDER_BASE_URLS } from '../../config/constants.js';
import type { AnthropicNativeRequest, AnthropicNativeResponse } from '../../types/anthropic.js';

export interface AnthropicPassthroughOptions {
  baseUrl?: string;
  apiKey?: string;
  forwardHeaders?: Record<string, string | string[] | undefined>;
}

export class AnthropicPassthrough {
  private readonly baseUrl: string;

  constructor(baseUrl: string = PROVIDER_BASE_URLS.anthropic) {
    this.baseUrl = baseUrl.replace(/\/$/, '');
  }

  async messages(
    req: AnthropicNativeRequest,
    options: AnthropicPassthroughOptions = {},
  ): Promise<AnthropicNativeResponse> {
    const url = `${(options.baseUrl ?? this.baseUrl).replace(/\/$/, '')}/v1/messages`;

    const headers: Record<string, string> = {
      'content-type': 'application/json',
      'anthropic-version': ANTHROPIC_VERSION,
    };

    // Forward incoming auth-related headers verbatim so the user's existing
    // claude-code credentials flow through unchanged.
    const forwarded = options.forwardHeaders ?? {};
    for (const [name, value] of Object.entries(forwarded)) {
      const lower = name.toLowerCase();
      if (
        lower === 'x-api-key' ||
        lower === 'authorization' ||
        lower === 'anthropic-beta' ||
        lower === 'anthropic-version'
      ) {
        const v = Array.isArray(value) ? value[0] : value;
        if (typeof v === 'string') headers[lower] = v;
      }
    }

    if (options.apiKey && !headers['x-api-key'] && !headers['authorization']) {
      headers['x-api-key'] = options.apiKey;
    }

    const body: AnthropicNativeRequest = { ...req, stream: false };

    const response = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Anthropic API error ${response.status}: ${text}`);
    }

    return response.json() as Promise<AnthropicNativeResponse>;
  }
}
