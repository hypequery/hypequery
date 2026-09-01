export type MCPExecutionErrorCode =
  | 'MCP_REQUEST_CANCELLED'
  | 'MCP_QUERY_TIMEOUT'
  | 'MCP_RESULT_TOO_LARGE';

export class MCPExecutionBudgetError extends Error {
  readonly code: MCPExecutionErrorCode;

  constructor(code: MCPExecutionErrorCode, message: string) {
    super(message);
    this.name = 'MCPExecutionBudgetError';
    this.code = code;
  }
}

export function formatMCPToolError(error: unknown): string {
  if (error instanceof MCPExecutionBudgetError) {
    return `Error [${error.code}]: ${error.message}`;
  }
  return `Error: ${error instanceof Error ? error.message : String(error)}`;
}
