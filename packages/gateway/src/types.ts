import type { CacheObservability, DevIntegrationApi } from '@hypequery/serve/dev';
export type { GatewayCapability, KnownGatewayCapability } from '@hypequery/gateway-contract';

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
