/**
 * The neutral shapes the tool adapters share. Nothing here depends on an
 * agent SDK, so the core client can be used in any agent loop.
 */

/**
 * A bearer token, or a function returning the current one. The function is
 * called before every HTTP request, so a short-lived token (a minted agent
 * token lasts at most 15 minutes) can be replaced while tools stay in use.
 */
export type HypequeryToken = string | (() => string | Promise<string>);

/** A `fetch` implementation; defaults to the global one. */
export type HypequeryFetch = (url: string | URL, init?: RequestInit) => Promise<Response>;

export interface HypequeryToolsOptions {
  /**
   * The tenant MCP endpoint, e.g. `https://<environment>.hypequery.app/mcp`.
   * https only, except on localhost: anything else throws a `TypeError`.
   */
  url: string | URL;
  /** Sent as `Authorization: Bearer <token>` on every request. */
  token: HypequeryToken;
  /** Extra headers sent on every request, such as `x-hypequery-tenant-id`. */
  headers?: Record<string, string>;
  /** Custom `fetch`, for tests, proxies or runtimes without a global one. */
  fetch?: HypequeryFetch;
  /** Client name reported to the server. @default '@hypequery/agent' */
  clientName?: string;
  /**
   * Close the MCP session after this long without a call; the next call opens
   * a new one. `0` keeps it open until `close()`. @default 60000
   */
  idleTimeoutMs?: number;
  /**
   * Called after every tool call with its result, including the request id
   * hypequery logged it under. Use it to link an answer to "explain this
   * answer" in Cloud.
   */
  onResult?: (result: HypequeryToolResult) => void;
}

/** A JSON Schema object, exactly as the server lists it. */
export interface HypequeryJsonSchema {
  type: 'object';
  properties?: Record<string, unknown>;
  required?: string[];
  [key: string]: unknown;
}

/** One tool as the server lists it. */
export interface HypequeryToolDefinition {
  name: string;
  title?: string;
  /** The server's description, or `''` when it has none. */
  description: string;
  /** The server's input schema, unchanged. */
  inputSchema: HypequeryJsonSchema;
  outputSchema?: HypequeryJsonSchema;
  annotations?: Record<string, unknown>;
}

/**
 * The stable codes of hypequery's MCP error envelope, as `@hypequery/mcp`
 * defines them. A newer server may add codes, so `code` also accepts any string.
 */
export type HypequeryToolErrorCode =
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

export type HypequeryToolErrorCategory =
  | 'correctable_input'
  | 'unauthorized'
  | 'stale_contract'
  | 'budget'
  | 'internal';

/** hypequery's MCP error envelope (`structuredContent.error` on a failed call). */
export interface HypequeryToolErrorDetails {
  code: HypequeryToolErrorCode | (string & {});
  category: HypequeryToolErrorCategory | (string & {});
  message: string;
  retryable: boolean;
  correctable: boolean;
  retryAfterSeconds?: number;
  relist?: boolean;
  reason?: string;
  /** The next action, in one sentence. */
  hint?: string;
  /** A page explaining the failure. */
  docsUrl?: string;
  /** The request id hypequery logged this call under. */
  requestId?: string;
}

interface HypequeryToolResultBase {
  /** The tool that was called. */
  tool: string;
  /** The request id hypequery logged this call under, when the server sent one. */
  requestId?: string;
  /** The MCP `CallToolResult`, unchanged. */
  raw: Record<string, unknown>;
}

export interface HypequeryToolSuccess extends HypequeryToolResultBase {
  ok: true;
  /** `structuredContent`, or the text content parsed as JSON, or the text itself. */
  data: unknown;
}

export interface HypequeryToolFailure extends HypequeryToolResultBase {
  ok: false;
  error: HypequeryToolErrorDetails;
}

/** A tool call's outcome. A tool error is a result the model can act on, not an exception. */
export type HypequeryToolResult = HypequeryToolSuccess | HypequeryToolFailure;

export interface HypequeryCallOptions {
  /** Aborting rejects the call with the signal's reason (an `AbortError` by default). */
  signal?: AbortSignal;
}

/** A connection to one tenant MCP endpoint. */
export interface HypequeryToolsClient {
  /** The server's tools, listed once and cached. */
  listTools(options?: HypequeryCallOptions): Promise<HypequeryToolDefinition[]>;
  /** Call a tool. Tool errors resolve as `{ ok: false }`; transport and auth failures reject. */
  callTool(name: string, input: unknown, options?: HypequeryCallOptions): Promise<HypequeryToolResult>;
  /** End the MCP session. Later calls open a new one. */
  close(): Promise<void>;
}

/**
 * A transport-neutral MCP tool executor, run in your own process. Structurally
 * `@hypequery/mcp`'s `MCPToolExecutor` (from `createMCPExecutor`), so this
 * package does not depend on it.
 */
export interface HypequeryToolExecutor {
  listTools(signal?: AbortSignal): Promise<{
    tools: Array<{
      name: string;
      title?: string;
      description?: string;
      inputSchema: Record<string, unknown>;
      outputSchema?: Record<string, unknown>;
      annotations?: Record<string, unknown>;
    }>;
    nextCursor?: string;
  }>;
  callTool(name: string, args?: Record<string, unknown>, signal?: AbortSignal): Promise<Record<string, unknown>>;
}

/**
 * Tools served by an executor in this process: no endpoint, no token, no
 * network. The executor decides the tenant (pass `tenantId` from your own
 * server-side session to `createMCPExecutor`), so create one per request.
 */
export interface HypequeryInProcessToolsOptions {
  executor: HypequeryToolExecutor;
  /**
   * Only these tools, by name; the rest are neither listed nor callable. For
   * example `['list_datasets', 'get_dataset_schema', 'query_dataset',
   * 'get_business_context']`, hypequery Cloud's tenant tool set.
   */
  tools?: readonly string[];
  /** Called after every tool call with its result. */
  onResult?: (result: HypequeryToolResult) => void;
}

/**
 * Adapters accept connection options for an endpoint, an executor in this
 * process, or a client you manage (and close) yourself.
 */
export type HypequeryToolsSource = HypequeryToolsOptions | HypequeryInProcessToolsOptions | HypequeryToolsClient;
