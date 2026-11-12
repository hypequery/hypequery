export type MCPToolErrorCode =
  | 'MCP_INVALID_ARGUMENTS'
  | 'MCP_NOT_FOUND'
  | 'MCP_UNKNOWN_TOOL'
  | 'MCP_UNAUTHORIZED'
  | 'MCP_STALE_CONTRACT'
  | 'MCP_REQUEST_CANCELLED'
  | 'MCP_QUERY_TIMEOUT'
  | 'MCP_RESULT_TOO_LARGE'
  | 'MCP_CATALOG_TOO_LARGE'
  | 'MCP_RATE_LIMITED'
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
  /** Seconds to wait before retrying, when the host knows (a rate limit, an outage). */
  retryAfterSeconds?: number;
  /** The caller must re-read discovery (`list_datasets`, schemas) before retrying. */
  relist?: boolean;
  /**
   * The host's own stable code for this failure, such as a semantic data
   * plane's `HQ_SEMANTIC_TENANT_REQUIRED` or a gateway's quota code. `code`
   * stays the portable classification; this lets an agent tell two failures
   * with the same `code` apart without parsing the message.
   */
  reason?: string;
  /** The next action, in one sentence: what the agent should do to recover. */
  hint?: string;
  /** A page that explains this failure and how to fix it. */
  docsUrl?: string;
  /** The host's request id, so a person can find this call in its logs. */
  requestId?: string;
}

/** Optional host details an `MCPToolError` carries into its envelope. */
export interface MCPToolErrorOptions {
  category?: MCPToolErrorCategory;
  retryable?: boolean;
  correctable?: boolean;
  retryAfterSeconds?: number;
  relist?: boolean;
  reason?: string;
  hint?: string;
  docsUrl?: string;
  requestId?: string;
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
    // `MCP_CATALOG_TOO_LARGE` is not retryable: the same catalog produces the
    // same manifest every time. A caller fixes it by publishing fewer targets
    // or choosing a tool mode that does not name every one of them.
    case 'MCP_REQUEST_CANCELLED':
    case 'MCP_RESULT_TOO_LARGE':
    case 'MCP_CATALOG_TOO_LARGE':
      return { category: 'budget', retryable: false, correctable: false };
    case 'MCP_QUERY_TIMEOUT':
    case 'MCP_RATE_LIMITED':
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
  readonly retryAfterSeconds?: number;
  readonly relist?: boolean;
  readonly reason?: string;
  readonly hint?: string;
  readonly docsUrl?: string;
  readonly requestId?: string;

  constructor(
    code: MCPToolErrorCode,
    message: string,
    options: MCPToolErrorOptions = {},
  ) {
    super(message);
    const defaults = defaultErrorMetadata(code);
    this.name = 'MCPToolError';
    this.code = code;
    this.category = options.category ?? defaults.category;
    this.retryable = options.retryable ?? defaults.retryable;
    this.correctable = options.correctable ?? defaults.correctable;
    if (options.retryAfterSeconds !== undefined) {
      if (!Number.isFinite(options.retryAfterSeconds) || options.retryAfterSeconds < 0) {
        throw new RangeError('retryAfterSeconds must be a finite, non-negative number');
      }
      this.retryAfterSeconds = options.retryAfterSeconds;
    }
    if (options.relist !== undefined) this.relist = options.relist;
    if (options.reason !== undefined) this.reason = options.reason;
    if (options.hint !== undefined) this.hint = options.hint;
    if (options.docsUrl !== undefined) this.docsUrl = options.docsUrl;
    if (options.requestId !== undefined) this.requestId = options.requestId;
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

/**
 * A catalog too large to advertise.
 *
 * Separate from `MCPExecutionBudgetError` because it is not raised by a query:
 * it is raised while listing, before any call exists, and a hosted gateway is
 * expected to catch it and choose a smaller tool mode rather than surface it to
 * a client. Truncating instead would be worse — an agent would be shown fewer
 * targets than the validators behind it accept, and the manifest hash would
 * stop identifying the catalog it was built from.
 */
export class MCPCatalogBudgetError extends MCPToolError {
  declare readonly code: 'MCP_CATALOG_TOO_LARGE';

  constructor(message: string) {
    super('MCP_CATALOG_TOO_LARGE', message, { category: 'budget', retryable: false });
    this.name = 'MCPCatalogBudgetError';
  }
}

export function classifyMCPToolError(error: unknown): MCPErrorDetails {
  if (error instanceof MCPToolError) {
    return {
      code: error.code,
      category: error.category,
      message: error.message,
      retryable: error.retryable,
      correctable: error.correctable,
      ...(error.retryAfterSeconds === undefined ? {} : { retryAfterSeconds: error.retryAfterSeconds }),
      ...(error.relist === undefined ? {} : { relist: error.relist }),
      ...(error.reason === undefined ? {} : { reason: error.reason }),
      ...(error.hint === undefined ? {} : { hint: error.hint }),
      ...(error.docsUrl === undefined ? {} : { docsUrl: error.docsUrl }),
      ...(error.requestId === undefined ? {} : { requestId: error.requestId }),
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
