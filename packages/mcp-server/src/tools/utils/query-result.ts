import type { DatasetQueryResult } from '@hypequery/datasets';
import type { QueryResultResponse } from '../../types.js';

export function buildMCPQueryResult(
  result: DatasetQueryResult,
  includeSql = false,
): QueryResultResponse {
  const cache = result.meta?.cache;
  return {
    data: result.data,
    meta: {
      ...(includeSql && result.meta?.sql ? { sql: result.meta.sql } : {}),
      ...(result.meta?.timingMs === undefined ? {} : { timingMs: result.meta.timingMs }),
      rowCount: result.data.length,
      ...(result.meta?.pagination ? { pagination: result.meta.pagination } : {}),
      cache: cache
        ? {
            status: cache.hit ? 'hit' : 'miss',
            ...(cache.ageMs === undefined ? {} : { ageMs: cache.ageMs }),
            ...(cache.stale === undefined ? {} : { stale: cache.stale }),
          }
        : { status: 'bypass' },
    },
  };
}
