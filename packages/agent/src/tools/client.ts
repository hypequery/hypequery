import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport, StreamableHTTPError } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import {
  dataFromResult,
  errorFromResult,
  readRequestId,
  toHypequeryToolsError,
} from './errors.js';
import type {
  HypequeryCallOptions,
  HypequeryFetch,
  HypequeryJsonSchema,
  HypequeryToolDefinition,
  HypequeryToolResult,
  HypequeryToolsClient,
  HypequeryToolsOptions,
  HypequeryToolsSource,
} from './types.js';

const DEFAULT_IDLE_TIMEOUT_MS = 60_000;
const CLIENT_VERSION = '0.0.0';

interface Session {
  readonly client: Client;
  readonly transport: StreamableHTTPClientTransport;
}

function isClient(source: HypequeryToolsSource): source is HypequeryToolsClient {
  return typeof (source as Partial<HypequeryToolsClient>).callTool === 'function';
}

/** The client behind an adapter: the one given, or a new one for the options. */
export function resolveToolsClient(source: HypequeryToolsSource): HypequeryToolsClient {
  return isClient(source) ? source : createHypequeryToolsClient(source);
}

function toDefinition(tool: {
  name: string;
  title?: string;
  description?: string;
  inputSchema: Record<string, unknown>;
  outputSchema?: Record<string, unknown>;
  annotations?: Record<string, unknown>;
}): HypequeryToolDefinition {
  return {
    name: tool.name,
    ...(tool.title === undefined ? {} : { title: tool.title }),
    description: tool.description ?? '',
    inputSchema: tool.inputSchema as HypequeryJsonSchema,
    ...(tool.outputSchema === undefined ? {} : { outputSchema: tool.outputSchema as HypequeryJsonSchema }),
    ...(tool.annotations === undefined ? {} : { annotations: tool.annotations }),
  };
}

/** The session is gone (expired, or the server restarted): reconnecting is safe. */
function sessionLost(error: unknown): boolean {
  return error instanceof StreamableHTTPError && error.code === 404;
}

class HypequeryMCPToolsClient implements HypequeryToolsClient {
  private session: Promise<Session> | undefined;
  private tools: Promise<HypequeryToolDefinition[]> | undefined;
  private inFlight = 0;
  private idleTimer: ReturnType<typeof setTimeout> | undefined;
  private readonly url: URL;
  private readonly fetch: HypequeryFetch;
  private readonly idleTimeoutMs: number;

  constructor(private readonly options: HypequeryToolsOptions) {
    if (options === null || typeof options !== 'object') {
      throw new TypeError('hypequeryTools: pass { url, token }.');
    }
    this.url = new URL(options.url);
    if (typeof options.token !== 'string' && typeof options.token !== 'function') {
      throw new TypeError('hypequeryTools: token must be a string or a function returning one.');
    }
    const idle = options.idleTimeoutMs ?? DEFAULT_IDLE_TIMEOUT_MS;
    if (!Number.isFinite(idle) || idle < 0) {
      throw new RangeError('hypequeryTools: idleTimeoutMs must be a non-negative number.');
    }
    this.idleTimeoutMs = idle;
    const baseFetch = options.fetch ?? ((url, init) => globalThis.fetch(url, init));
    this.fetch = async (url, init) => {
      const headers = new Headers(init?.headers);
      for (const [name, value] of Object.entries(options.headers ?? {})) headers.set(name, value);
      headers.set('authorization', `Bearer ${await this.token()}`);
      return baseFetch(url, { ...init, headers });
    };
  }

  private async token(): Promise<string> {
    const token = typeof this.options.token === 'function' ? await this.options.token() : this.options.token;
    if (typeof token !== 'string' || token.trim().length === 0) {
      throw new TypeError('hypequeryTools: token is empty.');
    }
    return token.trim();
  }

  private connect(): Promise<Session> {
    if (this.session === undefined) {
      const opening = (async () => {
        const transport = new StreamableHTTPClientTransport(this.url, { fetch: this.fetch });
        const client = new Client({ name: this.options.clientName ?? '@hypequery/agent', version: CLIENT_VERSION });
        await client.connect(transport);
        return { client, transport };
      })();
      this.session = opening;
      opening.catch(() => {
        if (this.session === opening) this.session = undefined;
      });
    }
    return this.session;
  }

  private async drop(session: Promise<Session>): Promise<void> {
    if (this.session === session) this.session = undefined;
    const open = await session.catch(() => undefined);
    if (open === undefined) return;
    await open.transport.terminateSession().catch(() => undefined);
    await open.client.close().catch(() => undefined);
  }

  /** Run one request on the session, reconnecting once if the server lost it. */
  private async run<T>(operation: (client: Client) => Promise<T>): Promise<T> {
    this.inFlight += 1;
    if (this.idleTimer !== undefined) clearTimeout(this.idleTimer);
    this.idleTimer = undefined;
    try {
      for (let attempt = 0; ; attempt += 1) {
        const session = this.connect();
        try {
          return await operation((await session).client);
        } catch (error) {
          if (attempt === 0 && sessionLost(error)) {
            await this.drop(session);
            continue;
          }
          throw toHypequeryToolsError(error);
        }
      }
    } finally {
      this.inFlight -= 1;
      this.scheduleIdleClose();
    }
  }

  private scheduleIdleClose(): void {
    if (this.inFlight > 0 || this.idleTimeoutMs === 0 || this.session === undefined) return;
    const session = this.session;
    this.idleTimer = setTimeout(() => {
      this.idleTimer = undefined;
      if (this.inFlight === 0) void this.drop(session);
    }, this.idleTimeoutMs);
    // An idle session must not keep a Node process alive.
    (this.idleTimer as { unref?: () => void }).unref?.();
  }

  listTools(options: HypequeryCallOptions = {}): Promise<HypequeryToolDefinition[]> {
    if (this.tools === undefined) {
      const listing = this.run(async (client) => {
        const tools: HypequeryToolDefinition[] = [];
        let cursor: string | undefined;
        do {
          const page = await client.listTools(cursor === undefined ? {} : { cursor }, { signal: options.signal });
          tools.push(...page.tools.map(toDefinition));
          cursor = page.nextCursor;
        } while (cursor !== undefined);
        return tools;
      });
      this.tools = listing;
      listing.catch(() => {
        if (this.tools === listing) this.tools = undefined;
      });
    }
    return this.tools;
  }

  async callTool(name: string, input: unknown, options: HypequeryCallOptions = {}): Promise<HypequeryToolResult> {
    const args = input === undefined || input === null ? {} : input;
    if (typeof args !== 'object' || Array.isArray(args)) {
      throw new TypeError(`hypequeryTools: input for ${name} must be an object.`);
    }
    const raw = await this.run(client => client.callTool(
      { name, arguments: args as Record<string, unknown> },
      undefined,
      { signal: options.signal },
    )) as Record<string, unknown>;
    const requestId = readRequestId(raw);
    let result: HypequeryToolResult;
    if (raw.isError === true) {
      const error = errorFromResult(raw);
      if (error.requestId === undefined && requestId !== undefined) error.requestId = requestId;
      const id = requestId ?? error.requestId;
      result = { ok: false, tool: name, error, ...(id === undefined ? {} : { requestId: id }), raw };
    } else {
      result = { ok: true, tool: name, data: dataFromResult(raw), ...(requestId === undefined ? {} : { requestId }), raw };
    }
    this.options.onResult?.(result);
    return result;
  }

  async close(): Promise<void> {
    if (this.idleTimer !== undefined) clearTimeout(this.idleTimer);
    this.idleTimer = undefined;
    if (this.session !== undefined) await this.drop(this.session);
  }
}

/**
 * A client for one tenant MCP endpoint over Streamable HTTP, for agent loops
 * without an MCP client of their own. The adapters build on it; use it directly
 * to call tools from your own loop or to manage the session's lifetime.
 */
export function createHypequeryToolsClient(options: HypequeryToolsOptions): HypequeryToolsClient {
  return new HypequeryMCPToolsClient(options);
}

/** What the model sees for a result: the data, or `{ error }` with hypequery's envelope. */
export function toModelOutput(result: HypequeryToolResult): unknown {
  return result.ok ? result.data : { error: result.error };
}
