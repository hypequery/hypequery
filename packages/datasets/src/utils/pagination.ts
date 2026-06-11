import type { MetricResultMeta } from '../types.js';

export type PaginationMeta = NonNullable<MetricResultMeta['pagination']>;

/**
 * When a limit is set, request one extra row so the executor can report
 * `hasMore` without issuing a separate COUNT query. Returns `undefined` when
 * no limit is set (unbounded query — there is no "next page").
 */
export function overfetchLimit(limit?: number): number | undefined {
  return limit != null ? limit + 1 : undefined;
}

/**
 * Trim an over-fetched result set back to `limit` rows and derive pagination
 * metadata. The extra row (if present) signals that another page exists.
 */
export function applyPagination<T>(
  rows: T[],
  limit?: number,
  offset?: number,
): { data: T[]; pagination?: PaginationMeta } {
  if (limit == null) {
    return { data: rows };
  }
  const hasMore = rows.length > limit;
  const data = hasMore ? rows.slice(0, limit) : rows;
  return {
    data,
    pagination: { limit, offset: offset ?? 0, hasMore },
  };
}
