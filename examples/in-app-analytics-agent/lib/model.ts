import { anthropic } from '@ai-sdk/anthropic';
import { openai } from '@ai-sdk/openai';
import { createProviderRegistry, type LanguageModel } from 'ai';

/**
 * The chat model, chosen by `AI_MODEL` as `<provider>:<model id>`. Each
 * provider reads its own key from the environment (`ANTHROPIC_API_KEY`,
 * `OPENAI_API_KEY`). To use another AI SDK provider, install it and add it here.
 */
const registry = createProviderRegistry({ anthropic, openai });

export const DEFAULT_MODEL = 'anthropic:claude-opus-5-5';

export function chatModel(): LanguageModel {
  const id = process.env.AI_MODEL?.trim() || DEFAULT_MODEL;
  return registry.languageModel(id as `anthropic:${string}` | `openai:${string}`);
}
