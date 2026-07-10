import type { FastifyRequest, FastifyReply } from 'fastify';
import type { ChatCompletionRequest, ChatMessage } from '../../types/providers.js';
import { governancePromptForMode } from '../../governance/compiler/policy-mode.js';

function chatRequestText(body: ChatCompletionRequest | undefined): string {
  return body?.messages.map((message) => message.content).join('\n\n') ?? '';
}

export async function requestCompilerHook(
  request: FastifyRequest,
  _reply: FastifyReply,
): Promise<void> {
  // Only inject into OpenAI-shaped chat completion requests. The /v1/messages
  // route handles Anthropic-shaped injection itself.
  if (request.url !== '/v1/chat/completions') return;
  const config = request.server.truegateConfig;

  const body = request.body as ChatCompletionRequest | undefined;
  if (!body?.messages) return;

  const context = request.governanceContext;
  const governance = governancePromptForMode(context, config.policyMode, chatRequestText(body));
  if (!governance) return;

  const systemMessage: ChatMessage = {
    role: 'system',
    content: governance,
  };

  const existingSystem = body.messages.filter((m) => m.role === 'system');
  const rest = body.messages.filter((m) => m.role !== 'system');

  if (existingSystem.length > 0) {
    const merged: ChatMessage = {
      role: 'system',
      content: existingSystem.map((m) => m.content).join('\n\n') + '\n\n' + governance,
    };
    request.body = { ...body, messages: [merged, ...rest] } satisfies ChatCompletionRequest;
  } else {
    request.body = { ...body, messages: [systemMessage, ...rest] } satisfies ChatCompletionRequest;
  }
}
