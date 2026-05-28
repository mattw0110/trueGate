import { fetch } from 'undici';
import {
  ANTHROPIC_VERSION,
  ANTHROPIC_DEFAULT_MODEL,
  PROVIDER_BASE_URLS,
} from '../../config/constants.js';
import type {
  Provider,
  ChatCompletionRequest,
  ChatCompletionResponse,
  ChatMessage,
} from '../../types/providers.js';

interface AnthropicContentBlock {
  type: 'text';
  text: string;
}

interface AnthropicMessage {
  role: 'user' | 'assistant';
  content: string | AnthropicContentBlock[];
}

interface AnthropicRequest {
  model: string;
  messages: AnthropicMessage[];
  system?: string;
  max_tokens: number;
  temperature?: number;
}

interface AnthropicResponse {
  id: string;
  type: string;
  role: 'assistant';
  model: string;
  content: AnthropicContentBlock[];
  stop_reason: string | null;
  usage: {
    input_tokens: number;
    output_tokens: number;
  };
}

function toAnthropicModel(model: string): string {
  if (model.startsWith('claude-')) return model;
  // Map common OpenAI model names to sensible Claude defaults
  if (model.includes('gpt-4')) return 'claude-opus-4-5';
  if (model.includes('gpt-3')) return 'claude-haiku-4-5';
  return ANTHROPIC_DEFAULT_MODEL;
}

function translateRequest(req: ChatCompletionRequest): AnthropicRequest {
  const systemMessages = req.messages.filter((m) => m.role === 'system');
  const nonSystemMessages = req.messages.filter((m) => m.role !== 'system');

  const system = systemMessages.map((m) => m.content).join('\n\n') || undefined;

  const messages: AnthropicMessage[] = nonSystemMessages.map((m) => ({
    role: m.role === 'assistant' ? 'assistant' : 'user',
    content: m.content,
  }));

  // Anthropic requires at least one message and must start with user
  if (messages.length === 0 || messages[0]?.role !== 'user') {
    messages.unshift({ role: 'user', content: '(start)' });
  }

  const anthropicReq: AnthropicRequest = {
    model: toAnthropicModel(req.model),
    messages,
    max_tokens: req.max_tokens ?? 4096,
  };

  if (system !== undefined) anthropicReq.system = system;
  if (req.temperature !== undefined) anthropicReq.temperature = req.temperature;

  return anthropicReq;
}

function translateResponse(
  anthropic: AnthropicResponse,
  originalModel: string,
): ChatCompletionResponse {
  const text = anthropic.content.map((b) => b.text).join('');

  const assistantMessage: ChatMessage = {
    role: 'assistant',
    content: text,
  };

  return {
    id: anthropic.id,
    object: 'chat.completion',
    created: Math.floor(Date.now() / 1000),
    model: originalModel,
    choices: [
      {
        index: 0,
        message: assistantMessage,
        finish_reason: anthropic.stop_reason ?? 'stop',
      },
    ],
    usage: {
      prompt_tokens: anthropic.usage.input_tokens,
      completion_tokens: anthropic.usage.output_tokens,
      total_tokens: anthropic.usage.input_tokens + anthropic.usage.output_tokens,
    },
  };
}

export class AnthropicProvider implements Provider {
  private readonly apiKey: string;
  private readonly baseUrl: string;

  constructor(apiKey: string, baseUrl: string = PROVIDER_BASE_URLS.anthropic) {
    this.apiKey = apiKey;
    this.baseUrl = baseUrl.replace(/\/$/, '');
  }

  async complete(req: ChatCompletionRequest): Promise<ChatCompletionResponse> {
    const url = `${this.baseUrl}/v1/messages`;
    const body = translateRequest(req);

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': this.apiKey,
        'anthropic-version': ANTHROPIC_VERSION,
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Anthropic API error ${response.status}: ${text}`);
    }

    const anthropicResponse = (await response.json()) as AnthropicResponse;
    return translateResponse(anthropicResponse, req.model);
  }
}
