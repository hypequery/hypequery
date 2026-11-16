import { dataFromResult, errorFromResult, readRequestId } from '../errors.js';
import type { HypequeryJsonSchema, HypequeryToolDefinition, HypequeryToolResult } from '../types.js';

/** A tool as an MCP `tools/list` page carries it. */
export interface ListedTool {
  name: string;
  title?: string;
  description?: string;
  inputSchema: Record<string, unknown>;
  outputSchema?: Record<string, unknown>;
  annotations?: Record<string, unknown>;
}

/** One listed tool in the shape every adapter reads. */
export function toDefinition(tool: ListedTool): HypequeryToolDefinition {
  return {
    name: tool.name,
    ...(tool.title === undefined ? {} : { title: tool.title }),
    description: tool.description ?? '',
    inputSchema: tool.inputSchema as HypequeryJsonSchema,
    ...(tool.outputSchema === undefined ? {} : { outputSchema: tool.outputSchema as HypequeryJsonSchema }),
    ...(tool.annotations === undefined ? {} : { annotations: tool.annotations }),
  };
}

/** An MCP `CallToolResult` as a hypequery result: the data, or the error envelope. */
export function toToolResult(name: string, raw: Record<string, unknown>): HypequeryToolResult {
  const requestId = readRequestId(raw);
  if (raw.isError === true) {
    const error = errorFromResult(raw);
    if (error.requestId === undefined && requestId !== undefined) error.requestId = requestId;
    const id = requestId ?? error.requestId;
    return { ok: false, tool: name, error, ...(id === undefined ? {} : { requestId: id }), raw };
  }
  return { ok: true, tool: name, data: dataFromResult(raw), ...(requestId === undefined ? {} : { requestId }), raw };
}

/** A tool call's input as MCP arguments: `{}` for none, a `TypeError` for anything but an object. */
export function toToolArguments(name: string, input: unknown): Record<string, unknown> {
  const args = input === undefined || input === null ? {} : input;
  if (typeof args !== 'object' || Array.isArray(args)) {
    throw new TypeError(`hypequeryTools: input for ${name} must be an object.`);
  }
  return args as Record<string, unknown>;
}
