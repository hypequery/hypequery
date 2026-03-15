/**
 * defineMetrics() — standalone factory for metric endpoint blocks.
 *
 * Returns a sealed MetricsBlock that can be plugged into defineServe/createAPI.
 * Decouples metric endpoint definition from the global API config.
 *
 * @example
 * ```ts
 * import { defineMetrics } from '@hypequery/serve';
 *
 * const metrics = defineMetrics(qb, {
 *   totalRevenue,
 *   avgOrderValue: { metric: avgOrderValue, cache: 300_000 },
 * });
 *
 * const api = defineServe({ metrics, queries: { ... } });
 * ```
 */

import type { AuthContext, AuthStrategy } from '../../types.js';
import type { MetricRef } from './types.js';
import type { QueryBuilderFactoryLike } from './query-builder-protocol.js';

// ---------------------------------------------------------------------------
// Per-metric entry types (same as MetricEntry but scoped here)
// ---------------------------------------------------------------------------

/** Shorthand (just the ref) or expanded with per-metric overrides. */
export type MetricEntryInput<TAuth extends AuthContext = AuthContext> =
  | MetricRef<any, any>
  | {
      metric: MetricRef<any, any>;
      auth?: AuthStrategy<TAuth> | null;
      cache?: number | null;
      requiredRoles?: string[];
      requiredScopes?: string[];
    };

/** Map of metric names to entries. */
export type MetricsInput<TAuth extends AuthContext = AuthContext> =
  Record<string, MetricEntryInput<TAuth>>;

// ---------------------------------------------------------------------------
// Block-level options
// ---------------------------------------------------------------------------

/** Defaults applied to all metrics in this block. */
export interface DefineMetricsOptions<TAuth extends AuthContext = AuthContext> {
  /** Default cache TTL (ms) for all metrics in this block. */
  cache?: number | null;
  /** Default auth strategy for all metrics in this block. */
  auth?: AuthStrategy<TAuth> | null;
}

// ---------------------------------------------------------------------------
// MetricsBlock — the sealed output
// ---------------------------------------------------------------------------

/** Opaque block returned by defineMetrics(). Consumed by createAPI/defineServe. */
export interface MetricsBlock<TAuth extends AuthContext = AuthContext> {
  readonly __type: 'metrics_block';
  readonly entries: Record<string, MetricEntryInput<TAuth>>;
  readonly builderFactory: QueryBuilderFactoryLike;
  readonly defaults?: DefineMetricsOptions<TAuth>;
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

export function defineMetrics<TAuth extends AuthContext = AuthContext>(
  queryBuilder: QueryBuilderFactoryLike,
  metrics: MetricsInput<TAuth>,
  options?: DefineMetricsOptions<TAuth>,
): MetricsBlock<TAuth> {
  return {
    __type: 'metrics_block',
    entries: metrics,
    builderFactory: queryBuilder,
    defaults: options,
  };
}
