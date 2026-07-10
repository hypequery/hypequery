import type { DevIntegrationApi } from '@hypequery/serve/dev';

/**
 * Capability strings advertised by GET /__dev/meta. The studio UI renders
 * only what the gateway advertises. Additive-only within contract 0.x.
 */
export type GatewayCapability =
  | 'registry'
  | 'execute'
  | 'history'
  | 'events'
  | 'cache'
  | 'schema'
  | 'ai';

/**
 * Minimal structural interface for a serve-layer cache store. Defined locally
 * so the gateway does not depend on serve's cache implementation (which lands
 * separately); cache endpoints are gated behind the `cache` capability and are
 * inert when no store is provided.
 */
export interface CacheStore {
  getStats(): Promise<CacheStatsSnapshot> | CacheStatsSnapshot;
  clear(): Promise<void> | void;
  deletePattern?(pattern: string): Promise<number> | number;
}

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
