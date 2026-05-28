import type { FastifyRequest, FastifyReply } from 'fastify';
import type { ChatCompletionRequest, ChatMessage } from '../../types/providers.js';

export async function requestCompilerHook(
  request: FastifyRequest,
  _reply: FastifyReply,
): Promise<void> {
  // Only inject into OpenAI-shaped chat completion requests. The /v1/messages
  // route handles Anthropic-shaped injection itself.
  if (request.url !== '/v1/chat/completions') return;

  const context = request.governanceContext;
  if (!context || !context.systemMessage.trim()) return;

  const body = request.body as ChatCompletionRequest | undefined;
  if (!body?.messages) return;

  const systemMessage: ChatMessage = {
    role: 'system',
    content: context.systemMessage,
  };

  const existingSystem = body.messages.filter((m) => m.role === 'system');
  const rest = body.messages.filter((m) => m.role !== 'system');

  if (existingSystem.length > 0) {
    const merged: ChatMessage = {
      role: 'system',
      content: existingSystem.map((m) => m.content).join('\n\n') + '\n\n' + context.systemMessage,
    };
    request.body = { ...body, messages: [merged, ...rest] } satisfies ChatCompletionRequest;
  } else {
    request.body = { ...body, messages: [systemMessage, ...rest] } satisfies ChatCompletionRequest;
  }
}
