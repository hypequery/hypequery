import type { FinishReason, UIMessage } from 'ai';

/**
 * A chat message with the model's finish reason attached by the route, so the
 * UI can tell a declined answer from an empty one.
 */
export type ChatMessage = UIMessage<{ finishReason?: FinishReason }>;

/**
 * `content-filter` is how the AI SDK reports a model's safety classifier
 * declining the turn (Anthropic's `refusal` stop reason). With fallbacks on,
 * it means the fallback model declined too.
 */
export function wasDeclined(message: ChatMessage): boolean {
  return message.role === 'assistant' && message.metadata?.finishReason === 'content-filter';
}
