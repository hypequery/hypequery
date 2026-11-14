/**
 * `@hypequery/agent/openai-agents`: the tenant endpoint's tools for the OpenAI
 * Agents SDK.
 *
 * ```ts
 * import { Agent, run } from '@openai/agents';
 * import { hypequeryTools } from '@hypequery/agent/openai-agents';
 *
 * const agent = new Agent({ name: 'Analyst', tools: await hypequeryTools({ url: mcpUrl, token }) });
 * const result = await run(agent, 'How many shipments were late last month?');
 * ```
 */
import { tool, type FunctionTool } from '@openai/agents';
import { resolveToolsClient, toModelOutput } from './client.js';
import type { HypequeryToolsSource } from './types.js';

/** One hypequery tool as an Agents SDK function tool. */
export type HypequeryOpenAITool = FunctionTool<any, any, string>;

type NonStrictParameters = Extract<Parameters<typeof tool>[0], { strict: false }>['parameters'];

/**
 * List the endpoint's tools once and return them as Agents SDK function tools.
 *
 * The server's JSON Schemas are passed through unchanged, so the tools are not
 * `strict` (strict mode would need every property required). A tool error is
 * returned to the model as `{ "error": { code, message, hint, ... } }`. A
 * refused token or an unreachable endpoint throws `HypequeryToolsError`, which
 * the Agents SDK handles with the tool's error function.
 */
export async function hypequeryTools(source: HypequeryToolsSource): Promise<HypequeryOpenAITool[]> {
  const client = resolveToolsClient(source);
  const definitions = await client.listTools();
  return definitions.map(definition => tool({
    name: definition.name,
    description: definition.description,
    parameters: definition.inputSchema as unknown as NonStrictParameters,
    strict: false,
    execute: async (input, _context, details) => JSON.stringify(toModelOutput(
      await client.callTool(definition.name, input, { signal: details?.signal }),
    )) ?? 'null',
  }) as HypequeryOpenAITool);
}

export { createHypequeryToolsClient, toModelOutput } from './client.js';
export { HypequeryToolsError } from './errors.js';
export type * from './types.js';
