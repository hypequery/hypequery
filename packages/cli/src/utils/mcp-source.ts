/**
 * Mirrors `@hypequery/serve`'s `ServeMcpSource`. Read through the global symbol
 * registry rather than by importing serve: serve is a peer dependency that
 * lives in the user's project, and a static import here would be resolved by
 * Node before any CLI code runs, breaking even `hypequery --help` on a clean
 * install. Keep the key in step with `server/mcp-source.ts`.
 */
const MCP_SOURCE_SYMBOL = Symbol.for('hypequery.mcp-source.v1');

export interface ServeMcpSource {
  readonly version: 1;
  readonly datasets: Readonly<Record<string, unknown>>;
  readonly resolveAnalytics: () => unknown;
  /** The application's auth strategies and tenant extraction, when it configures auth. */
  readonly auth?: {
    readonly strategies: readonly ((context: { request: unknown }) => Promise<unknown>)[];
    readonly tenant?: { readonly extract: (auth: never) => string | null | undefined };
  };
  /** Datasets and metrics whose own access rules the MCP transport does not apply. */
  readonly restricted?: readonly {
    readonly kind: 'dataset' | 'metric';
    readonly name: string;
    readonly rules: readonly string[];
  }[];
  /** How many global middlewares REST runs before every endpoint; MCP does not run them. */
  readonly globalMiddlewareCount?: () => number;
}

export function readServeMcpSource(value: unknown): ServeMcpSource | undefined {
  if (value === null || (typeof value !== 'object' && typeof value !== 'function')) {
    return undefined;
  }
  const source = (value as Record<symbol, unknown>)[MCP_SOURCE_SYMBOL] as
    | Partial<ServeMcpSource>
    | undefined;
  return source?.version === 1 && typeof source.resolveAnalytics === 'function'
    ? source as ServeMcpSource
    : undefined;
}

function hasTenantKey(dataset: unknown): boolean {
  const value = dataset as { tenantKey?: unknown; config?: { tenantKey?: unknown } };
  const tenantKey = value?.tenantKey ?? value?.config?.tenantKey;
  return typeof tenantKey === 'string' && tenantKey.length > 0;
}

/** Datasets a caller cannot query unless a trusted tenant is configured. */
export function tenantScopedDatasets(datasets: Record<string, unknown>): string[] {
  return Object.entries(datasets)
    .filter(([, dataset]) => hasTenantKey(dataset))
    .map(([name]) => name)
    .sort();
}

/**
 * Datasets with no `tenantKey`. The planner can add no tenant filter to them, so REST refuses a
 * caller that has a tenant, and MCP must refuse to serve them to one rather than return every row.
 */
export function datasetsWithoutTenantKey(datasets: Record<string, unknown>): string[] {
  return Object.entries(datasets)
    .filter(([, dataset]) => !hasTenantKey(dataset))
    .map(([name]) => name)
    .sort();
}

