/**
 * Self-hosted remote MCP over Streamable HTTP.
 *
 * `createMCPHttpHandler` answers Fetch `Request`s, so it runs on Node (through
 * `listenMCPHttpServer`), Bun, Deno, Workers or inside an existing router. Each
 * MCP session belongs to the principal that opened it and gets its own
 * executor, created for that principal's tenant.
 */

import { randomUUID } from 'node:crypto';
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';
import { isInitializeRequest } from '@modelcontextprotocol/sdk/types.js';
import type { MCPToolExecutor } from './executor.js';
import { assertPrincipal, MCPHttpAuthError, type MCPHttpAuthenticator, type MCPPrincipal } from './http-auth.js';
import { HypequeryMCPProtocolServer } from './protocol-server.js';
import {
  hostAllowed,
  normalizeAllowedHosts,
  normalizeAllowedOrigins,
  originAllowed,
} from './utils/http-server/guards.js';
import {
  bearerChallenge,
  protectedResource,
  type MCPProtectedResourceOptions,
  type ProtectedResource,
} from './utils/http-server/oauth.js';
import {
  BodyTooLargeError,
  jsonResponse,
  jsonRpcErrorResponse,
  onBodyEnd,
  plainResponse,
  readBoundedBody,
} from './utils/http-server/responses.js';

export type { MCPProtectedResourceOptions } from './utils/http-server/oauth.js';

export interface MCPHttpHandlerOptions {
  /** Verifies each request's credential. Every request must authenticate. */
  authenticate: MCPHttpAuthenticator;
  /**
   * Creates the executor for a new session's principal. Use the principal's
   * `tenantId` as the trusted tenant: it came from a verified credential.
   */
  createExecutor: (principal: MCPPrincipal, signal?: AbortSignal) => MCPToolExecutor | Promise<MCPToolExecutor>;
  /** Server name reported to clients. */
  name?: string;
  /** Server version reported to clients. */
  version?: string;
  /** The MCP endpoint path. @default '/mcp' */
  path?: string;
  /** `Host` names (ports ignored) this server answers. @default loopback names only */
  allowedHosts?: readonly string[];
  /** Browser origins allowed to call. Requests without `Origin` are always allowed. @default none */
  allowedOrigins?: readonly string[];
  /** OAuth resource-server settings: metadata, challenges and required scopes. */
  oauth?: MCPProtectedResourceOptions;
  /** Concurrent sessions; more are refused with 503. @default 100 */
  maxSessions?: number;
  /** A session with no request in flight for this long is closed. @default 30 minutes */
  sessionIdleTimeoutMs?: number;
  /** Largest accepted request body. @default 1 MiB */
  maxRequestBodyBytes?: number;
}

export interface MCPHttpHandler {
  /** Answer one HTTP request. */
  handle(request: Request): Promise<Response>;
  /** Number of open MCP sessions. */
  readonly sessionCount: number;
  /** Close every session and stop accepting requests. */
  close(): Promise<void>;
}

interface Session {
  readonly owner: string;
  readonly server: HypequeryMCPProtocolServer;
  readonly transport: WebStandardStreamableHTTPServerTransport;
  active: number;
  lastActivity: number;
}

const DEFAULT_MAX_SESSIONS = 100;
const DEFAULT_IDLE_TIMEOUT_MS = 30 * 60 * 1000;
const DEFAULT_MAX_BODY_BYTES = 1024 * 1024;
const MAX_SWEEP_INTERVAL_MS = 60 * 1000;

function positiveInteger(value: number | undefined, fallback: number, label: string): number {
  if (value === undefined) return fallback;
  if (!Number.isSafeInteger(value) || value <= 0) throw new TypeError(`${label} must be a positive integer.`);
  return value;
}

/** Sessions belong to a subject and tenant, so a refreshed token keeps its session. */
function ownerKey(principal: MCPPrincipal): string {
  return JSON.stringify([principal.subject, principal.tenantId ?? null]);
}

function missingScopes(principal: MCPPrincipal, required: readonly string[]): string[] {
  const granted = new Set(principal.scopes ?? []);
  return required.filter(scope => !granted.has(scope));
}

function containsInitialize(body: unknown): boolean {
  return Array.isArray(body) ? body.some(message => isInitializeRequest(message)) : isInitializeRequest(body);
}

class HypequeryMCPHttpHandler implements MCPHttpHandler {
  private readonly sessions = new Map<string, Session>();
  private readonly allowedHosts: ReadonlySet<string>;
  private readonly allowedOrigins: ReadonlySet<string>;
  private readonly resource?: ProtectedResource;
  private readonly path: string;
  private readonly maxSessions: number;
  private readonly idleTimeoutMs: number;
  private readonly maxBodyBytes: number;
  private readonly sweeper: ReturnType<typeof setInterval>;
  private opening = 0;
  private closed = false;

  constructor(private readonly options: MCPHttpHandlerOptions) {
    if (typeof options.authenticate !== 'function') {
      throw new TypeError('createMCPHttpHandler: authenticate is required; every request must carry a credential.');
    }
    if (typeof options.createExecutor !== 'function') {
      throw new TypeError('createMCPHttpHandler: createExecutor is required.');
    }
    this.path = options.path ?? '/mcp';
    if (!this.path.startsWith('/') || this.path.includes('?') || this.path.includes('#')) {
      throw new TypeError('createMCPHttpHandler: path must be an absolute path such as /mcp.');
    }
    this.allowedHosts = normalizeAllowedHosts(options.allowedHosts);
    this.allowedOrigins = normalizeAllowedOrigins(options.allowedOrigins);
    this.resource = options.oauth ? protectedResource(options.oauth) : undefined;
    this.maxSessions = positiveInteger(options.maxSessions, DEFAULT_MAX_SESSIONS, 'maxSessions');
    this.idleTimeoutMs = positiveInteger(options.sessionIdleTimeoutMs, DEFAULT_IDLE_TIMEOUT_MS, 'sessionIdleTimeoutMs');
    this.maxBodyBytes = positiveInteger(options.maxRequestBodyBytes, DEFAULT_MAX_BODY_BYTES, 'maxRequestBodyBytes');
    this.sweeper = setInterval(() => this.sweep(), Math.min(this.idleTimeoutMs, MAX_SWEEP_INTERVAL_MS));
    (this.sweeper as { unref?: () => void }).unref?.();
  }

  get sessionCount(): number {
    return this.sessions.size;
  }

  async handle(request: Request): Promise<Response> {
    if (this.closed) return plainResponse(503, 'Service Unavailable');
    const url = new URL(request.url);

    // 1. DNS rebinding: an attacker's page reaching a private address still sends its own Host.
    if (!hostAllowed(request.headers.get('host') ?? url.host, this.allowedHosts)) {
      return plainResponse(421, 'Misdirected Request');
    }

    // 2. Routing. Metadata is public: clients read it to find the authorization server.
    if (this.resource && url.pathname === this.resource.metadataPath) {
      if (request.method !== 'GET') return plainResponse(405, 'Method Not Allowed', { allow: 'GET' });
      return jsonResponse(200, this.resource.document);
    }
    if (url.pathname !== this.path) return plainResponse(404, 'Not Found');

    // 3. Browser pages may call only from listed origins.
    if (!originAllowed(request.headers.get('origin'), this.allowedOrigins)) {
      return plainResponse(403, 'Forbidden');
    }

    // 4. Credentials.
    let principal: MCPPrincipal | null;
    try {
      principal = await this.options.authenticate(request);
    } catch (error) {
      if (error instanceof MCPHttpAuthError) return this.challenge(error.code, error.scopes);
      return plainResponse(500, 'Internal Server Error');
    }
    if (principal === null || principal === undefined) return this.challenge(undefined);
    try {
      assertPrincipal(principal);
    } catch {
      return plainResponse(500, 'Internal Server Error');
    }
    const missing = missingScopes(principal, this.resource?.requiredScopes ?? []);
    if (missing.length > 0) return this.challenge('insufficient_scope', this.resource?.requiredScopes);

    // 5. Sessions.
    const sessionId = request.headers.get('mcp-session-id');
    if (sessionId !== null) {
      const session = this.sessions.get(sessionId);
      // Another principal's session answers exactly like an unknown one.
      if (!session || session.owner !== ownerKey(principal)) {
        return jsonRpcErrorResponse(404, -32001, 'Session not found');
      }
      return this.dispatch(session, request);
    }
    return this.open(principal, request);
  }

  private challenge(error: 'invalid_token' | 'insufficient_scope' | undefined, scopes?: readonly string[]): Response {
    const status = error === 'insufficient_scope' ? 403 : 401;
    return plainResponse(status, status === 401 ? 'Unauthorized' : 'Forbidden', {
      'www-authenticate': bearerChallenge(error, this.resource, scopes),
    });
  }

  private async parsedBody(request: Request): Promise<{ body?: unknown; refusal?: Response }> {
    if (request.method !== 'POST') return {};
    let text: string;
    try {
      text = await readBoundedBody(request, this.maxBodyBytes);
    } catch (error) {
      if (error instanceof BodyTooLargeError) return { refusal: jsonRpcErrorResponse(413, -32000, 'Request body too large') };
      return { refusal: jsonRpcErrorResponse(400, -32700, 'Parse error') };
    }
    try {
      return { body: JSON.parse(text) };
    } catch {
      return { refusal: jsonRpcErrorResponse(400, -32700, 'Parse error') };
    }
  }

  private async dispatch(session: Session, request: Request): Promise<Response> {
    const { body, refusal } = await this.parsedBody(request);
    if (refusal) return refusal;
    session.active += 1;
    session.lastActivity = Date.now();
    let response: Response;
    try {
      response = await session.transport.handleRequest(request, body === undefined ? undefined : { parsedBody: body });
    } catch (error) {
      session.active -= 1;
      throw error;
    }
    return onBodyEnd(response, () => {
      session.active -= 1;
      session.lastActivity = Date.now();
    });
  }

  private async open(principal: MCPPrincipal, request: Request): Promise<Response> {
    if (request.method !== 'POST') {
      return jsonRpcErrorResponse(400, -32000, 'Bad Request: Mcp-Session-Id header is required');
    }
    const { body, refusal } = await this.parsedBody(request);
    if (refusal) return refusal;
    // Only an initialize request may open a session, and nothing is built for anything else.
    if (!containsInitialize(body)) {
      return jsonRpcErrorResponse(400, -32000, 'Bad Request: Server not initialized');
    }
    if (this.sessions.size + this.opening >= this.maxSessions) {
      return jsonRpcErrorResponse(503, -32603, 'Too many open sessions');
    }

    this.opening += 1;
    let session: Session | undefined;
    try {
      let executor: MCPToolExecutor;
      try {
        executor = await this.options.createExecutor(principal, request.signal);
      } catch {
        // Executor errors may name backends or credentials; none reach the client.
        return jsonRpcErrorResponse(503, -32603, 'MCP server unavailable');
      }
      const server = new HypequeryMCPProtocolServer({
        executor,
        name: this.options.name,
        version: this.options.version,
      });
      const owner = ownerKey(principal);
      const transport: WebStandardStreamableHTTPServerTransport = new WebStandardStreamableHTTPServerTransport({
        sessionIdGenerator: () => randomUUID().replaceAll('-', ''),
        maxRequestBodySize: this.maxBodyBytes,
        onsessioninitialized: (id) => {
          if (session) this.sessions.set(id, session);
        },
        onsessionclosed: (id) => {
          this.sessions.delete(id);
        },
      });
      session = { owner, server, transport, active: 1, lastActivity: Date.now() };
      transport.onclose = () => {
        if (transport.sessionId) this.sessions.delete(transport.sessionId);
      };
      await server.connect(transport);
      const response = await transport.handleRequest(request, { parsedBody: body });
      if (transport.sessionId === undefined || !this.sessions.has(transport.sessionId)) {
        // The initialize request was refused; nothing may linger.
        session.active -= 1;
        await server.close().catch(() => undefined);
        return response;
      }
      const opened = session;
      return onBodyEnd(response, () => {
        opened.active -= 1;
        opened.lastActivity = Date.now();
      });
    } finally {
      this.opening -= 1;
    }
  }

  private sweep(): void {
    const cutoff = Date.now() - this.idleTimeoutMs;
    for (const [id, session] of this.sessions) {
      if (session.active === 0 && session.lastActivity < cutoff) {
        this.sessions.delete(id);
        void session.server.close().catch(() => undefined);
      }
    }
  }

  async close(): Promise<void> {
    this.closed = true;
    clearInterval(this.sweeper);
    const sessions = [...this.sessions.values()];
    this.sessions.clear();
    await Promise.all(sessions.map(session => session.server.close().catch(() => undefined)));
  }
}

/**
 * A Fetch handler serving MCP over Streamable HTTP.
 *
 * Every request is checked in order: `Host` (DNS rebinding), route, `Origin`,
 * credential, then session ownership. Sessions are held in memory, so run one
 * process per server or route each session's requests to the same process.
 */
export function createMCPHttpHandler(options: MCPHttpHandlerOptions): MCPHttpHandler {
  return new HypequeryMCPHttpHandler(options);
}
