import type { MetricResultMeta } from '@hypequery/datasets';

/** Public metadata is allowlisted; a request flag cannot grant debug access. */
export function semanticResponseMeta(
  meta: MetricResultMeta | undefined,
  trustedDiagnostics = false,
): MetricResultMeta | undefined {
  if (meta === undefined) return undefined;
  return {
    timingMs: meta.timingMs,
    rowCount: meta.rowCount,
    pagination: meta.pagination,
    cache: meta.cache,
    resultLimit: meta.resultLimit,
    ...(trustedDiagnostics ? { sql: meta.sql, tenant: meta.tenant } : {}),
  };
}
