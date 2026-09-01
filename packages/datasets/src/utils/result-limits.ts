import type { DatasetLimits, MetricResultMeta } from '../types.js';

export type ResultLimitMeta = NonNullable<MetricResultMeta['resultLimit']>;

export interface ResolvedResultLimit {
  /** The limit to execute with; `undefined` leaves the query unbounded. */
  limit?: number;
  /** Meta to surface, present only when the declared ceiling supplied the limit. */
  meta?: ResultLimitMeta;
}

/**
 * Applies a dataset's declared `maxResultSize` to a query that set no limit.
 *
 * Query validation already rejects a limit *above* the ceiling, so the case
 * left open is the one with no limit at all: `query.limit != null` guards both
 * validators, so an unbounded query has always skipped the ceiling entirely and
 * streamed whatever the table held. A ceiling that only binds callers who
 * happened to name a limit is not a ceiling.
 *
 * Bounding is reported, never silent. A caller who asked for everything and
 * received 1,000 rows cannot otherwise distinguish a bounded answer from a
 * complete one, and 1,000 rows is a plausible-looking number.
 */
export function resolveResultLimit(
  requested: number | undefined,
  limits: DatasetLimits | undefined,
): ResolvedResultLimit {
  const maxResultSize = limits?.maxResultSize;

  if (maxResultSize === undefined || requested !== undefined) {
    return { limit: requested };
  }

  return {
    limit: maxResultSize,
    meta: { maxResultSize, applied: maxResultSize },
  };
}

/**
 * Merges result-limit meta onto a pending result.
 *
 * Takes the promise rather than the resolved value so the caller stays
 * synchronous: query validation throws before execution begins, and callers
 * (and their tests) rely on that being a synchronous throw rather than a
 * rejected promise.
 */
export function withResultLimit<T extends { meta?: MetricResultMeta }>(
  result: Promise<T>,
  meta: ResultLimitMeta | undefined,
): Promise<T> {
  if (meta === undefined) {
    return result;
  }
  return result.then((value) => ({
    ...value,
    meta: { ...(value.meta ?? {}), resultLimit: { ...meta } },
  }));
}
