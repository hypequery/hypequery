import type { CacheObservability, DevIntegrationApi } from '@hypequery/serve/dev';

/**
 * Capability strings advertised by GET /__dev/meta. The studio UI renders
 * only what the gateway advertises. Additive-only within contract 0.x.
 * `cache:clear` is a sub-capability of `cache`: advertised only when at least
 * one cache layer is wired for clearing.
 */
export type GatewayCapability =
  | 'registry'
  | 'execute'
  | 'history'
  | 'events'
  | 'cache'
  | 'cache:clear'
  | 'schema'
  | 'ai';

/**
 * Per-layer cache stats/clear, provided by serve's `DevIntegrationApi`
 * (aggregating the semantic query cache and the query-builder cache — serve
 * itself holds no cache).
 */
export type { CacheObservability };

/**
 * Approximate hit/miss stats derived from persisted query history — the
 * fallback for `GET /__dev/cache` when no cache layer is observable.
 */
export interface CacheStatsSnapshot {
  hits: number;
  misses: number;
  staleHits?: number;
  revalidations?: number;
  hitRate: number;
  size?: number;
}

/**
 * The serve API the gateway drives. Re-exported from serve's `./dev` subpath —
 * `ServeBuilder` satisfies it structurally.
 */
export type { DevIntegrationApi };
