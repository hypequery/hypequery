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

/** Datasets a caller cannot query unless a trusted tenant is configured. */
export function tenantScopedDatasets(datasets: Record<string, unknown>): string[] {
  return Object.entries(datasets)
    .filter(([, dataset]) => {
      const value = dataset as { tenantKey?: unknown; config?: { tenantKey?: unknown } };
      const tenantKey = value?.tenantKey ?? value?.config?.tenantKey;
      return typeof tenantKey === 'string' && tenantKey.length > 0;
    })
    .map(([name]) => name)
    .sort();
}

