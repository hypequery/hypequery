import type { MCPErrorDetails } from '../../errors.js';
import { classifyMCPToolError, formatMCPToolError } from '../../errors.js';
import type { MCPToolResponse } from '../../types.js';

export function createMCPToolResponse<T extends object>(
  value: T,
  text = JSON.stringify(value),
): MCPToolResponse {
  return {
    content: [{ type: 'text', text }],
    structuredContent: value as Record<string, unknown>,
  };
}

export function createMCPErrorResponse(error: unknown): MCPToolResponse {
  const details: MCPErrorDetails = classifyMCPToolError(error);
  return {
    content: [{ type: 'text', text: formatMCPToolError(error) }],
    structuredContent: { error: details },
    isError: true,
  };
}
