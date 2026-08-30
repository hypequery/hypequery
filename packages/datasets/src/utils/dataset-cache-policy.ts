import type { DatasetCachePolicy, ExecutionContext } from '../types.js';
import type { SemanticCacheRuntime } from '../cache/semantic-query-cache.js';

/**
 * Folds a dataset's declared cache policy into one call's cache runtime.
 *
 * Precedence mirrors `resolveCompiledDeadline` in `@hypequery/clickhouse`: the
 * call site may shorten the window but never extend it. A declared `ttlMs`
 * supplies the default when nothing else does; a declared `maxTtlMs` clamps
 * whatever the caller or client asked for.
 *
 * The stale-while-revalidate window is clamped by the same ceiling, because a
 * result served stale past `maxTtlMs` is exactly what the ceiling exists to
 * prevent — the window would otherwise be a way around it.
 *
 * A caller that opted out (`cache: false`, `mode: 'bypass'`) stays opted out.
 * Opting out is a shortening, and a dataset policy is not a way to force a
 * result into a cache the caller declined.
 */
export function resolveDatasetCacheRuntime(
  policy: DatasetCachePolicy | undefined,
  callerCache: ExecutionContext['cache'],
): ExecutionContext['cache'] {
  if (policy === undefined) {
    return callerCache;
  }
  if (callerCache === false || callerCache?.mode === 'bypass') {
    return callerCache;
  }

  const requestedTtl = callerCache?.ttlMs ?? policy.ttlMs;
  const ttlMs = clamp(requestedTtl, policy.maxTtlMs);
  const staleWhileRevalidateMs = clamp(callerCache?.staleWhileRevalidateMs, policy.maxTtlMs);

  const resolved: SemanticCacheRuntime = { ...callerCache };
  if (ttlMs !== undefined) {
    resolved.ttlMs = ttlMs;
  }
  if (staleWhileRevalidateMs !== undefined) {
    resolved.staleWhileRevalidateMs = staleWhileRevalidateMs;
  }

  return resolved;
}

function clamp(value: number | undefined, ceiling: number | undefined): number | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (ceiling === undefined) {
    return value;
  }
  return Math.min(value, ceiling);
}
