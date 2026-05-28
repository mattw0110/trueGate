import { fetch } from 'undici';
import type {
  Provider,
  ChatCompletionRequest,
  ChatCompletionResponse,
} from '../../types/providers.js';

export interface OpenAICompatibleOptions {
  baseUrl: string;
  apiKey?: string;
  extraHeaders?: Record<string, string>;
}

export class OpenAICompatibleProvider implements Provider {
  private readonly baseUrl: string;
  private readonly apiKey: string | undefined;
  private readonly extraHeaders: Record<string, string>;

  constructor(options: OpenAICompatibleOptions) {
    // Accept both `https://host/v1` and `https://host`. We always emit
    // `${host}/v1/chat/completions` so callers don't have to remember.
    this.baseUrl = options.baseUrl.replace(/\/$/, '').replace(/\/v1$/, '');
    this.apiKey = options.apiKey;
    this.extraHeaders = options.extraHeaders ?? {};
  }

  async complete(req: ChatCompletionRequest): Promise<ChatCompletionResponse> {
    const url = `${this.baseUrl}/v1/chat/completions`;

    const headers: Record<string, string> = {
      'content-type': 'application/json',
      ...this.extraHeaders,
    };

    if (this.apiKey) {
      headers['authorization'] = `Bearer ${this.apiKey}`;
    }

    const body: ChatCompletionRequest = { ...req, stream: false };

    const response = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Provider API error ${response.status}: ${text}`);
    }

    return response.json() as Promise<ChatCompletionResponse>;
  }
}

// Backwards-compatible alias
export { OpenAICompatibleProvider as OpenAIProvider };
