import type { DatasetCatalogSource, DatasetClient } from '@hypequery/datasets';

/**
 * Lets `hypequery mcp` serve an application's datasets from the same
 * entrypoint local development already uses, instead of asking the author to
 * maintain a second MCP config that can drift from it.
 *
 * Attached under a registered symbol rather than a public property: it is a
 * build/tooling seam, not part of the API surface an application calls. The
 * same approach as `attachDeploymentBuildSource`.
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
