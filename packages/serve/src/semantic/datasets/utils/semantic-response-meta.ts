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
    pagination: meta.pagination === undefined ? undefined : {
      limit: meta.pagination.limit,
      offset: meta.pagination.offset,
      hasMore: meta.pagination.hasMore,
    },
    cache: meta.cache === undefined ? undefined : {
      hit: meta.cache.hit,
      ageMs: meta.cache.ageMs,
      stale: meta.cache.stale,
    },
    resultLimit: meta.resultLimit === undefined ? undefined : {
      maxResultSize: meta.resultLimit.maxResultSize,
      applied: meta.resultLimit.applied,
    },
    ...(trustedDiagnostics ? { sql: meta.sql, tenant: meta.tenant } : {}),
  };
}
