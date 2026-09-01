export type MCPToolErrorCode =
  | 'MCP_INVALID_ARGUMENTS'
  | 'MCP_NOT_FOUND'
  | 'MCP_UNKNOWN_TOOL'
  | 'MCP_UNAUTHORIZED'
  | 'MCP_STALE_CONTRACT'
  | 'MCP_REQUEST_CANCELLED'
  | 'MCP_QUERY_TIMEOUT'
  | 'MCP_RESULT_TOO_LARGE'
  | 'MCP_EXECUTION_FAILED';

export type MCPToolErrorCategory =
  | 'correctable_input'
  | 'unauthorized'
  | 'stale_contract'
  | 'budget'
  | 'internal';

/** @deprecated Use MCPToolErrorCode. */
export type MCPExecutionErrorCode = Extract<
  MCPToolErrorCode,
  'MCP_REQUEST_CANCELLED' | 'MCP_QUERY_TIMEOUT' | 'MCP_RESULT_TOO_LARGE'
>;

export interface MCPErrorDetails {
  code: MCPToolErrorCode;
  category: MCPToolErrorCategory;
  message: string;
  retryable: boolean;
  correctable: boolean;
}

function defaultErrorMetadata(code: MCPToolErrorCode): Omit<MCPErrorDetails, 'code' | 'message'> {
  switch (code) {
    case 'MCP_INVALID_ARGUMENTS':
    case 'MCP_NOT_FOUND':
    case 'MCP_UNKNOWN_TOOL':
      return { category: 'correctable_input', retryable: false, correctable: true };
    case 'MCP_UNAUTHORIZED':
      return { category: 'unauthorized', retryable: false, correctable: false };
    case 'MCP_STALE_CONTRACT':
      return { category: 'stale_contract', retryable: true, correctable: false };
    case 'MCP_REQUEST_CANCELLED':
    case 'MCP_RESULT_TOO_LARGE':
      return { category: 'budget', retryable: false, correctable: false };
    case 'MCP_QUERY_TIMEOUT':
      return { category: 'budget', retryable: true, correctable: false };
    case 'MCP_EXECUTION_FAILED':
      return { category: 'internal', retryable: true, correctable: false };
  }
}

export class MCPToolError extends Error {
  readonly code: MCPToolErrorCode;
  readonly category: MCPToolErrorCategory;
  readonly retryable: boolean;
  readonly correctable: boolean;

  constructor(
    code: MCPToolErrorCode,
    message: string,
    options: {
      category?: MCPToolErrorCategory;
      retryable?: boolean;
      correctable?: boolean;
    } = {},
  ) {
    super(message);
    const defaults = defaultErrorMetadata(code);
    this.name = 'MCPToolError';
    this.code = code;
    this.category = options.category ?? defaults.category;
    this.retryable = options.retryable ?? defaults.retryable;
    this.correctable = options.correctable ?? defaults.correctable;
  }
}

export class MCPExecutionBudgetError extends MCPToolError {
  declare readonly code: MCPExecutionErrorCode;

  constructor(code: MCPExecutionErrorCode, message: string) {
    super(code, message, {
      category: 'budget',
      retryable: code === 'MCP_QUERY_TIMEOUT',
    });
    this.name = 'MCPExecutionBudgetError';
  }
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function classifyMCPToolError(error: unknown): MCPErrorDetails {
  if (error instanceof MCPToolError) {
    return {
      code: error.code,
      category: error.category,
      message: error.message,
      retryable: error.retryable,
      correctable: error.correctable,
    };
  }

  const message = messageOf(error);
  if (message.startsWith('Unknown tool:')) {
    return {
      code: 'MCP_UNKNOWN_TOOL',
      category: 'correctable_input',
      message,
      retryable: false,
      correctable: true,
    };
  }
  if (message.includes('not found:') || message.startsWith('Metric not found:')) {
    return {
      code: 'MCP_NOT_FOUND',
      category: 'correctable_input',
      message,
      retryable: false,
      correctable: true,
    };
  }
  if (
    message.startsWith('Invalid ')
    || message.endsWith('parameter is required')
    || message.startsWith('At least one ')
  ) {
    return {
      code: 'MCP_INVALID_ARGUMENTS',
      category: 'correctable_input',
      message,
      retryable: false,
      correctable: true,
    };
  }

  return {
    code: 'MCP_EXECUTION_FAILED',
    category: 'internal',
    message: 'Query execution failed',
    retryable: true,
    correctable: false,
  };
}

export function formatMCPToolError(error: unknown): string {
  const classified = classifyMCPToolError(error);
  return `Error [${classified.code}]: ${classified.message}`;
}
