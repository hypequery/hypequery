import type { DatasetCachePolicy, ExecutionContext } from '../types.js';
import type { SemanticCacheOptions, SemanticCacheRuntime } from '../cache/semantic-query-cache.js';

/**
 * Client-level cache defaults, as the resolver needs to see them.
 *
 * They have to be resolved here rather than left to the cache: the cache fills a
 * missing `ttlMs` from its own defaults *after* this runs, so a value left
 * undefined here would be filled in unclamped and escape the dataset's ceiling
 * entirely.
 */
export type ClientCacheDefaults = Pick<
  SemanticCacheOptions,
  'ttlMs' | 'staleWhileRevalidateMs'
>;

/**
 * Folds a dataset's declared cache policy into one call's cache runtime.
 *
 * Precedence mirrors `resolveCompiledDeadline` in `@hypequery/clickhouse`: the
 * call site may shorten the window but never extend it. A declared `ttlMs`
 * supplies the default when neither the call nor the client does; a declared
 * `maxTtlMs` clamps whatever any of the three asked for.
 *
 * **`maxTtlMs` is a ceiling, not a default.** When no layer supplies a TTL, the
 * result stays uncached — a maximum lifetime is not a reason to start caching
 * something nobody asked to cache.
 *
 * **The ceiling bounds total age, not each window separately.** A cached entry
 * is servable for `ttlMs + staleWhileRevalidateMs`, so clamping the two
 * independently would allow twice the declared maximum. The stale window gets
 * whatever the TTL leaves of the budget.
 *
 * A caller that opted out (`cache: false`, `mode: 'bypass'`) stays opted out.
 * Opting out is a shortening, and a dataset policy is not a way to force a
 * result into a cache the caller declined.
 */
export function resolveDatasetCacheRuntime(
  policy: DatasetCachePolicy | undefined,
  callerCache: ExecutionContext['cache'],
  clientDefaults?: ClientCacheDefaults,
): ExecutionContext['cache'] {
  if (policy === undefined) {
    return callerCache;
  }
  if (callerCache === false || callerCache?.mode === 'bypass') {
    return callerCache;
  }

  // The value each layer would have produced, most specific first. The client
  // default is included so the ceiling below applies to it too.
  const requestedTtl = callerCache?.ttlMs ?? policy.ttlMs ?? clientDefaults?.ttlMs;
  const requestedStale =
    callerCache?.staleWhileRevalidateMs ?? clientDefaults?.staleWhileRevalidateMs;

  const resolved: SemanticCacheRuntime = { ...callerCache };

  if (policy.maxTtlMs === undefined) {
    // No ceiling: the policy only contributes a default TTL.
    if (requestedTtl !== undefined) {
      resolved.ttlMs = requestedTtl;
    }
    return resolved;
  }

  if (requestedTtl === undefined || requestedTtl <= 0) {
    // Nothing asked for caching; the ceiling does not create it.
    return resolved;
  }

  const ttlMs = Math.min(requestedTtl, policy.maxTtlMs);
  resolved.ttlMs = ttlMs;
  // Always set explicitly, including to 0: leaving it undefined would let the
  // client's own stale window be applied on top of an already-clamped TTL.
  resolved.staleWhileRevalidateMs = Math.min(
    requestedStale ?? 0,
    Math.max(0, policy.maxTtlMs - ttlMs),
  );

  return resolved;
}
