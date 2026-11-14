import { toHypequeryToolsError } from './errors.js';
import { untilAborted } from './utils/abort.js';
import { toDefinition, toToolArguments, toToolResult } from './utils/tool-result.js';
import type {
  HypequeryCallOptions,
  HypequeryInProcessToolsOptions,
  HypequeryToolDefinition,
  HypequeryToolResult,
  HypequeryToolsClient,
  HypequeryToolsSource,
} from './types.js';

/** `{ executor }`: tools served in this process. */
export function isInProcessSource(source: HypequeryToolsSource): source is HypequeryInProcessToolsOptions {
  return source !== null && typeof source === 'object' && 'executor' in source;
}

/**
 * An MCP executor passed where a client was expected. Clients close; executors
 * list prompts and report a manifest hash instead.
 */
export function looksLikeExecutor(source: unknown): boolean {
  if (source === null || typeof source !== 'object') return false;
  const value = source as Record<string, unknown>;
  return typeof value.callTool === 'function'
    && typeof value.close !== 'function'
    && (typeof value.getManifestHash === 'function' || typeof value.listPrompts === 'function');
}

function unknownTool(name: string): HypequeryToolResult {
  const message = `Unknown tool: ${name}`;
  const error = {
    code: 'MCP_UNKNOWN_TOOL',
    category: 'correctable_input',
    message,
    retryable: false,
    correctable: true,
  } as const;
  return {
    ok: false,
    tool: name,
    error: { ...error },
    raw: { isError: true, content: [{ type: 'text', text: `Error [MCP_UNKNOWN_TOOL]: ${message}` }], structuredContent: { error } },
  };
}

class HypequeryInProcessToolsClient implements HypequeryToolsClient {
  private tools: Promise<HypequeryToolDefinition[]> | undefined;
  private readonly allowed: ReadonlySet<string> | undefined;

  constructor(private readonly options: HypequeryInProcessToolsOptions) {
    const executor = options.executor as Partial<HypequeryInProcessToolsOptions['executor']> | undefined;
    if (!executor || typeof executor.listTools !== 'function' || typeof executor.callTool !== 'function') {
      throw new TypeError('hypequeryTools: executor must have listTools and callTool, e.g. createMCPExecutor(...) from @hypequery/mcp.');
    }
    if (options.tools !== undefined && !Array.isArray(options.tools)) {
      throw new TypeError('hypequeryTools: tools must be an array of tool names.');
    }
    this.allowed = options.tools === undefined ? undefined : new Set(options.tools);
  }

  private permits(name: string): boolean {
    return this.allowed === undefined || this.allowed.has(name);
  }

  listTools(options: HypequeryCallOptions = {}): Promise<HypequeryToolDefinition[]> {
    if (this.tools === undefined) {
      const listing = (async () => {
        try {
          const listed = await this.options.executor.listTools();
          return listed.tools.filter(tool => this.permits(tool.name)).map(toDefinition);
        } catch (error) {
          throw toHypequeryToolsError(error);
        }
      })();
      this.tools = listing;
      listing.catch(() => {
        if (this.tools === listing) this.tools = undefined;
      });
    }
    return untilAborted(this.tools, options.signal);
  }

  async callTool(name: string, input: unknown, options: HypequeryCallOptions = {}): Promise<HypequeryToolResult> {
    const args = toToolArguments(name, input);
    if (options.signal?.aborted) throw options.signal.reason;
    let result: HypequeryToolResult;
    if (!this.permits(name)) {
      result = unknownTool(name);
    } else {
      let raw: Record<string, unknown>;
      try {
        raw = await untilAborted(this.options.executor.callTool(name, args, options.signal), options.signal);
      } catch (error) {
        if (options.signal?.aborted) throw options.signal.reason;
        throw toHypequeryToolsError(error);
      }
      result = toToolResult(name, raw);
    }
    this.options.onResult?.(result);
    return result;
  }

  async close(): Promise<void> {
    // Nothing to close: no session, no transport.
  }
}

/**
 * A client for tools served by an executor in this process, such as
 * `createMCPExecutor({ datasets, analytics, tenantId })` from `@hypequery/mcp`.
 * Nothing leaves the process and no token is involved: the executor's
 * `tenantId`, set from your server-side session, scopes every query.
 *
 * ```ts
 * const executor = createMCPExecutor({ datasets, analytics, tenantId: session.tenantId });
 * const tools = await hypequeryTools({ executor });
 * ```
 */
export function createInProcessToolsClient(options: HypequeryInProcessToolsOptions): HypequeryToolsClient {
  return new HypequeryInProcessToolsClient(options);
}
