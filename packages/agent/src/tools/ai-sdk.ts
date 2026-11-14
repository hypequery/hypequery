/**
 * `@hypequery/agent/ai-sdk`: the tenant endpoint's tools for the Vercel AI SDK.
 *
 * ```ts
 * import { hypequeryTools } from '@hypequery/agent/ai-sdk';
 *
 * const tools = await hypequeryTools({ url: mcpUrl, token });
 * // or, in your own backend: hypequeryTools({ executor: createMCPExecutor({ datasets, analytics, tenantId }) })
 * const result = streamText({ model, tools, messages });
 * ```
 */
import { jsonSchema, tool, type Tool } from 'ai';
import { resolveToolsClient, toModelOutput } from './client.js';
import type { HypequeryToolsSource } from './types.js';

/** One hypequery tool as an AI SDK tool. Its output is the data, or `{ error }`. */
export type HypequeryAITool = Tool<Record<string, unknown>, unknown>;

/** The tenant endpoint's tools, keyed by name, ready for `generateText` or `streamText`. */
export type HypequeryAIToolSet = Record<string, HypequeryAITool>;

/**
 * List the endpoint's tools once and return them as AI SDK tools, with the
 * server's JSON Schemas as their input schemas.
 *
 * A tool error (bad input, unknown dataset, a timeout) is returned to the model
 * as `{ error: { code, message, hint, docsUrl, requestId, ... } }` so it can
 * correct itself. A refused token or an unreachable endpoint throws
 * `HypequeryToolsError`, which the AI SDK reports as a tool error.
 */
export async function hypequeryTools(source: HypequeryToolsSource): Promise<HypequeryAIToolSet> {
  const client = resolveToolsClient(source);
  const definitions = await client.listTools();
  const tools: HypequeryAIToolSet = {};
  for (const definition of definitions) {
    tools[definition.name] = tool<Record<string, unknown>, unknown, any>({
      description: definition.description,
      inputSchema: jsonSchema<Record<string, unknown>>(definition.inputSchema as Parameters<typeof jsonSchema>[0]),
      execute: async (input, { abortSignal }) => toModelOutput(
        await client.callTool(definition.name, input, { signal: abortSignal }),
      ),
    });
  }
  return tools;
}

export { createHypequeryToolsClient, toModelOutput } from './client.js';
export { createInProcessToolsClient } from './in-process.js';
export { HypequeryToolsError } from './errors.js';
export type * from './types.js';
