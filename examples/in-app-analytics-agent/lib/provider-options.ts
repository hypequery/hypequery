import type { AnthropicLanguageModelOptions } from '@ai-sdk/anthropic';

/**
 * Claude's safety classifiers can decline a turn they misread, for example a
 * customer asking how they compare with another customer. With
 * `fallbacks: 'default'`, Anthropic retries a declined turn on its recommended
 * fallback model inside the same request, instead of returning no answer.
 * Other providers ignore the `anthropic` options.
 */
export const CHAT_PROVIDER_OPTIONS = {
  anthropic: { fallbacks: 'default' } satisfies AnthropicLanguageModelOptions,
};
