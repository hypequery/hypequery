/**
 * Who is calling the self-hosted HTTP MCP server.
 *
 * An authenticator turns an HTTP request into an `MCPPrincipal`. The principal's
 * tenant is decided here, from a verified credential, never from tool arguments.
 */

import { bearerToken, secretsEqual } from './utils/http-server/bearer.js';

/** The verified caller behind one HTTP MCP session. */
export interface MCPPrincipal {
  /** Stable identity of the caller (a JWT `sub`, a key name). */
  subject: string;
  /** The tenant every tenant-scoped dataset is filtered to for this caller. */
  tenantId?: string;
  /** Granted scopes, checked against the server's required scopes. */
  scopes?: readonly string[];
}

/** Why a credential was refused, as an RFC 6750 error code. */
export type MCPHttpAuthErrorCode = 'invalid_token' | 'insufficient_scope';

/**
 * Thrown by an authenticator to refuse a presented credential. The message is
 * for server logs only; the HTTP response carries just the code.
 */
export class MCPHttpAuthError extends Error {
  readonly code: MCPHttpAuthErrorCode;
  readonly scopes?: readonly string[];

  constructor(code: MCPHttpAuthErrorCode, message?: string, options?: { scopes?: readonly string[] }) {
    super(message ?? (code === 'invalid_token' ? 'Invalid credential.' : 'Insufficient scope.'));
    this.name = 'MCPHttpAuthError';
    this.code = code;
    this.scopes = options?.scopes;
  }
}

/**
 * Authenticates one HTTP request. Return the principal, `null` when the request
 * carries no credential, or throw `MCPHttpAuthError` to refuse one.
 */
export type MCPHttpAuthenticator = (request: Request) => MCPPrincipal | null | Promise<MCPPrincipal | null>;

export interface MCPStaticKeyAuthenticatorOptions {
  /** The shared secret clients send as `Authorization: Bearer <key>`. At least 16 characters. */
  key: string;
  /** Subject reported for every caller. @default 'static-key' */
  subject?: string;
  /** Trusted tenant applied to every caller of this key. */
  tenantId?: string;
  /** Scopes granted to every caller of this key. */
  scopes?: readonly string[];
}

const MIN_STATIC_KEY_LENGTH = 16;

/**
 * One shared key for one principal: the simplest way to put a local or
 * single-tenant MCP server on the network. Use OAuth for per-user access.
 */
export function createMCPStaticKeyAuthenticator(options: MCPStaticKeyAuthenticatorOptions): MCPHttpAuthenticator {
  if (typeof options.key !== 'string' || options.key.trim().length < MIN_STATIC_KEY_LENGTH) {
    throw new TypeError(`createMCPStaticKeyAuthenticator: key must be at least ${MIN_STATIC_KEY_LENGTH} characters.`);
  }
  const key = options.key.trim();
  const principal: MCPPrincipal = Object.freeze({
    subject: options.subject ?? 'static-key',
    ...(options.tenantId !== undefined ? { tenantId: options.tenantId } : {}),
    ...(options.scopes !== undefined ? { scopes: Object.freeze([...options.scopes]) } : {}),
  });
  assertPrincipal(principal);
  return async (request) => {
    const token = bearerToken(request.headers.get('authorization'));
    if (token === undefined) return null;
    if (!(await secretsEqual(token, key))) throw new MCPHttpAuthError('invalid_token');
    return principal;
  };
}

/** The parts of `@hypequery/serve`'s `AuthContext` a principal is built from. */
export interface MCPServeAuthContext {
  userId?: string;
  tenantId?: string;
  scopes?: string[];
  [key: string]: unknown;
}

/** The request shape `@hypequery/serve` auth strategies read. */
export interface MCPServeAuthRequest {
  method: string;
  path: string;
  query: Record<string, string | string[] | undefined>;
  headers: Record<string, string | undefined>;
  raw?: unknown;
}

/** Structurally a `@hypequery/serve` `AuthStrategy`, such as `createJwtStrategy(...)`. */
export type MCPServeAuthStrategy<TAuth extends MCPServeAuthContext = MCPServeAuthContext> = (
  context: { request: MCPServeAuthRequest },
) => Promise<TAuth | null>;

export interface MCPServeAuthenticatorOptions<TAuth extends MCPServeAuthContext = MCPServeAuthContext> {
  /** One or more serve auth strategies, tried in order like `defineServe({ auth })`. */
  strategies: MCPServeAuthStrategy<TAuth> | readonly MCPServeAuthStrategy<TAuth>[];
  /**
   * This server's OAuth resource URL. Every `createJwtStrategy` strategy must accept exactly this
   * audience, so a token issued for another API cannot open a session; construction throws otherwise.
   * Strategies that are not `createJwtStrategy` ones cannot be inspected and are not checked.
   */
  audience?: string;
  /** Tenant extraction, like `defineServe({ tenant: { extract } })`. Defaults to `auth.tenantId`. */
  tenant?: { extract: (auth: TAuth) => string | null | undefined };
  /** Subject extraction. Defaults to `auth.userId`. */
  subject?: (auth: TAuth) => string | null | undefined;
}

function serveRequest(request: Request): MCPServeAuthRequest {
  const url = new URL(request.url);
  const headers: Record<string, string> = {};
  request.headers.forEach((value, name) => {
    headers[name] = value;
  });
  const query: Record<string, string | string[]> = {};
  url.searchParams.forEach((value, name) => {
    const existing = query[name];
    query[name] = existing === undefined ? value : Array.isArray(existing) ? [...existing, value] : [existing, value];
  });
  return { method: request.method, path: url.pathname, query, headers, raw: request };
}

/**
 * The audiences a `createJwtStrategy` strategy accepts. Read through the symbol registry, like
 * serve's own `readJwtAudience`, because serve is an optional peer that is not imported here.
 */
const JWT_AUDIENCE_SYMBOL = Symbol.for('hypequery.jwt-audience.v1');

function jwtAudiences(strategy: unknown): readonly string[] | undefined {
  if (typeof strategy !== 'function') return undefined;
  const value = (strategy as unknown as Record<symbol, { version?: unknown; audiences?: unknown } | undefined>)[JWT_AUDIENCE_SYMBOL];
  return value?.version === 1 && Array.isArray(value.audiences) ? value.audiences as string[] : undefined;
}

function assertAcceptsOnlyAudience(strategies: readonly unknown[], audience: string): void {
  for (const strategy of strategies) {
    const audiences = jwtAudiences(strategy);
    if (audiences === undefined) continue;
    if (audiences.length !== 1 || audiences[0] !== audience) {
      throw new TypeError(
        `createMCPServeAuthenticator: a JWT strategy must accept only the audience ${JSON.stringify(audience)} `
        + `(this server's resource URL), so a token issued for another API cannot open a session. It accepts `
        + `${audiences.length === 0 ? 'any audience' : JSON.stringify(audiences)}.`,
      );
    }
  }
}

/** A serve `AuthError`'s reason, matched structurally so serve stays an optional peer. */
function authErrorReason(error: unknown): string | undefined {
  if (typeof error !== 'object' || error === null) return undefined;
  const { name, reason } = error as { name?: unknown; reason?: unknown };
  return name === 'AuthError' && typeof reason === 'string' ? reason : undefined;
}

/**
 * Reuse an application's existing `@hypequery/serve` authentication, including
 * `createJwtStrategy` for OAuth access tokens, so MCP callers are verified,
 * scoped and assigned tenants exactly as the REST API does.
 *
 * Configure the JWT strategy's `audience` as this MCP server's resource URL:
 * a token issued for any other resource is then refused.
 */
export function createMCPServeAuthenticator<TAuth extends MCPServeAuthContext>(
  options: MCPServeAuthenticatorOptions<TAuth>,
): MCPHttpAuthenticator {
  const strategies = Array.isArray(options.strategies)
    ? [...options.strategies] as MCPServeAuthStrategy<TAuth>[]
    : [options.strategies as MCPServeAuthStrategy<TAuth>];
  if (strategies.length === 0 || strategies.some(strategy => typeof strategy !== 'function')) {
    throw new TypeError('createMCPServeAuthenticator: strategies must be one or more auth strategy functions.');
  }
  if (options.audience !== undefined) assertAcceptsOnlyAudience(strategies, options.audience);
  const extractTenant = options.tenant?.extract ?? ((auth: TAuth) => auth.tenantId);
  const extractSubject = options.subject ?? ((auth: TAuth) => auth.userId);

  return async (request) => {
    const context = { request: serveRequest(request) };
    let refused = false;
    for (const strategy of strategies) {
      let auth: TAuth | null;
      try {
        auth = await strategy(context);
      } catch (error) {
        // Same precedence as serve's pipeline: an invalid credential beats a missing one.
        const reason = authErrorReason(error);
        if (reason === 'INVALID') {
          refused = true;
          continue;
        }
        if (reason !== undefined) continue;
        throw error;
      }
      if (auth === null || auth === undefined) continue;
      const subject = extractSubject(auth);
      if (typeof subject !== 'string' || subject === '') {
        throw new MCPHttpAuthError('invalid_token', 'The verified credential names no subject.');
      }
      const tenantId = extractTenant(auth) ?? undefined;
      const scopes = Array.isArray(auth.scopes) ? auth.scopes.filter((scope): scope is string => typeof scope === 'string') : undefined;
      return {
        subject,
        ...(tenantId !== undefined ? { tenantId } : {}),
        ...(scopes !== undefined ? { scopes } : {}),
      };
    }
    if (refused) throw new MCPHttpAuthError('invalid_token');
    return null;
  };
}

/** Reject a malformed principal before it can own a session. */
export function assertPrincipal(principal: MCPPrincipal): void {
  if (typeof principal !== 'object' || principal === null) {
    throw new TypeError('An MCP authenticator must return a principal object or null.');
  }
  if (typeof principal.subject !== 'string' || principal.subject === '') {
    throw new TypeError('An MCP principal subject must be a non-empty string.');
  }
  if (principal.tenantId !== undefined && (typeof principal.tenantId !== 'string' || principal.tenantId === '')) {
    throw new TypeError('An MCP principal tenantId must be a non-empty string when present.');
  }
  if (principal.scopes !== undefined
    && (!Array.isArray(principal.scopes) || principal.scopes.some(scope => typeof scope !== 'string'))) {
    throw new TypeError('An MCP principal scopes must be an array of strings when present.');
  }
}
