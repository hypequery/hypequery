/**
 * `@hypequery/agent/anthropic`: the tenant endpoint's tools for the Anthropic
 * Messages API.
 *
 * ```ts
 * import { hypequeryTools } from '@hypequery/agent/anthropic';
 *
 * const hq = await hypequeryTools({ url: mcpUrl, token });
 * const message = await anthropic.messages.create({ model, max_tokens, tools: hq.tools, messages });
 * messages.push({ role: 'assistant', content: message.content });
 * messages.push({ role: 'user', content: await hq.toolResults(message.content) });
 * ```
 *
 * The types here are structural, so this module imports nothing from
 * `@anthropic-ai/sdk`; they are assignable to its `Tool` and
 * `ToolResultBlockParam`.
 */
import { resolveToolsClient, toModelOutput } from './client.js';
import type {
  HypequeryCallOptions,
  HypequeryJsonSchema,
  HypequeryToolResult,
  HypequeryToolsSource,
} from './types.js';

/** A tool definition for `messages.create({ tools })`. */
export interface AnthropicToolDefinition {
  name: string;
  description: string;
  input_schema: HypequeryJsonSchema;
}

/** A `tool_result` block answering one `tool_use` block. */
export interface AnthropicToolResultBlock {
  type: 'tool_result';
  tool_use_id: string;
  /** The data, or `{ error }` with hypequery's envelope, as JSON. */
  content: string;
  is_error?: boolean;
}

/** The parts of a `tool_use` block this module reads. */
export interface AnthropicToolUseLike {
  type: 'tool_use';
  id: string;
  name: string;
  input: unknown;
}

export interface HypequeryAnthropicTools {
  /** Pass as `tools` (alongside your own, if any). */
  tools: AnthropicToolDefinition[];
  /** Call one tool by name. */
  runTool(name: string, input: unknown, options?: HypequeryCallOptions): Promise<HypequeryToolResult>;
  /** Run one `tool_use` block and build its `tool_result`. */
  toolResult(block: AnthropicToolUseLike, options?: HypequeryCallOptions): Promise<AnthropicToolResultBlock>;
  /**
   * Run every hypequery `tool_use` block in a response's content, in parallel,
   * and return their `tool_result` blocks in order. Blocks for other tools are
   * left for you to answer.
   */
  toolResults(content: readonly unknown[], options?: HypequeryCallOptions): Promise<AnthropicToolResultBlock[]>;
  /** End the MCP session. */
  close(): Promise<void>;
}

function isToolUse(block: unknown): block is AnthropicToolUseLike {
  if (typeof block !== 'object' || block === null) return false;
  const candidate = block as Partial<AnthropicToolUseLike>;
  return candidate.type === 'tool_use' && typeof candidate.id === 'string' && typeof candidate.name === 'string';
}

/** Build the `tool_result` block for a result. */
export function toAnthropicToolResult(toolUseId: string, result: HypequeryToolResult): AnthropicToolResultBlock {
  return {
    type: 'tool_result',
    tool_use_id: toolUseId,
    content: JSON.stringify(toModelOutput(result)) ?? 'null',
    ...(result.ok ? {} : { is_error: true }),
  };
}

/**
 * List the endpoint's tools once and return them as Anthropic tool definitions,
 * with the server's JSON Schemas as `input_schema`, plus an executor.
 *
 * A tool error comes back as a `tool_result` with `is_error: true` and the
 * envelope (code, message, hint, docsUrl, requestId) as its content. A refused
 * token or an unreachable endpoint rejects with `HypequeryToolsError`.
 */
export async function hypequeryTools(source: HypequeryToolsSource): Promise<HypequeryAnthropicTools> {
  const client = resolveToolsClient(source);
  const definitions = await client.listTools();
  const names = new Set(definitions.map(definition => definition.name));

  const runTool = (name: string, input: unknown, options?: HypequeryCallOptions) => (
    client.callTool(name, input, options)
  );
  const toolResult = async (block: AnthropicToolUseLike, options?: HypequeryCallOptions) => (
    toAnthropicToolResult(block.id, await runTool(block.name, block.input, options))
  );

  return {
    tools: definitions.map(definition => ({
      name: definition.name,
      description: definition.description,
      input_schema: definition.inputSchema,
    })),
    runTool,
    toolResult,
    toolResults: (content, options) => Promise.all(
      content.filter(isToolUse).filter(block => names.has(block.name)).map(block => toolResult(block, options)),
    ),
    close: () => client.close(),
  };
}

export { createHypequeryToolsClient, toModelOutput } from './client.js';
export { createInProcessToolsClient } from './in-process.js';
export { HypequeryToolsError } from './errors.js';
export type * from './types.js';
