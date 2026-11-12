import type { DatasetCatalogSource, DatasetClient } from '@hypequery/datasets';
import type { AuthContext, AuthStrategy } from '../types.js';
import type { McpRestrictedEntry } from '../semantic/datasets/utils/mcp-restrictions.js';

/**
 * Lets `hypequery mcp` serve an application's datasets from the same
 * entrypoint local development already uses, instead of asking the author to
 * maintain a second MCP config that can drift from it.
 *
 * Attached under a registered symbol rather than a public property: it is a
 * build/tooling seam, not part of the API surface an application calls. The
 * This keeps the local MCP source out of the public API surface.
 */
const mcpSourceSymbol = Symbol.for('hypequery.mcp-source.v1');

export interface ServeMcpSource {
  readonly version: 1;
  /** Datasets keyed as registered, with named metrics grouped onto each. */
  readonly datasets: Readonly<Record<string, DatasetCatalogSource>>;
  /**
   * Resolves the shared semantic client. Deferred because the client is only
   * constructed once a semantic endpoint needs it, and an application with no
   * configured query builder should fail when MCP starts rather than at import.
   */
  readonly resolveAnalytics: () => DatasetClient;
  /**
   * The application's own authentication, so `hypequery mcp --http` verifies
   * callers and assigns tenants exactly as the REST API does. Absent when the
   * application configures no auth.
   */
  readonly auth?: ServeMcpAuth;
  /**
   * Datasets and metrics whose own entry options (auth, roles, scopes, middlewares,
   * tenant override) decide who may query them over REST. The MCP transport does not
   * apply those, so a server that verifies callers must refuse to serve them.
   */
  readonly restricted?: readonly McpRestrictedEntry[];
  /**
   * How many global middlewares (`defineServe({ middlewares })` and `api.use()`) REST runs
   * before every endpoint. The MCP transport does not run them, so a server that verifies
   * callers must refuse to serve when any are configured. Read lazily: `api.use()` may run
   * after `defineServe` returns.
   */
  readonly globalMiddlewareCount?: () => number;
}

/** The application's auth strategies and tenant extraction, as configured on `defineServe`. */
export interface ServeMcpAuth {
  readonly strategies: readonly AuthStrategy<AuthContext>[];
  readonly tenant?: { readonly extract: (auth: AuthContext) => string | null | undefined };
}

export function attachServeMcpSource(
  target: object,
  source: Omit<ServeMcpSource, 'version'>,
): void {
  Object.defineProperty(target, mcpSourceSymbol, {
    value: Object.freeze({
      version: 1,
      datasets: Object.freeze({ ...source.datasets }),
      resolveAnalytics: source.resolveAnalytics,
      ...(source.globalMiddlewareCount ? { globalMiddlewareCount: source.globalMiddlewareCount } : {}),
      ...(source.auth ? { auth: Object.freeze({ ...source.auth, strategies: Object.freeze([...source.auth.strategies]) }) } : {}),
      ...(source.restricted?.length
        ? { restricted: Object.freeze(source.restricted.map(entry => Object.freeze({ ...entry, rules: Object.freeze([...entry.rules]) }))) }
        : {}),
    } satisfies ServeMcpSource),
    enumerable: false,
    configurable: false,
    writable: false,
  });
}

/** Read the MCP source off a loaded Serve entrypoint, if it registered datasets. */
export function readServeMcpSource(value: unknown): ServeMcpSource | undefined {
  if (value === null || (typeof value !== 'object' && typeof value !== 'function')) {
    return undefined;
  }
  const source = (value as Record<symbol, unknown>)[mcpSourceSymbol];
  return isMcpSource(source) ? source : undefined;
}

function isMcpSource(value: unknown): value is ServeMcpSource {
  return (
    typeof value === 'object'
    && value !== null
    && (value as ServeMcpSource).version === 1
    && typeof (value as ServeMcpSource).resolveAnalytics === 'function'
  );
}
