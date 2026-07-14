/**
 * Aggregated cache observability for dev tooling.
 *
 * Serve owns no cache implementation (see plans/dev-playground-design.md,
 * "Cache architecture"): result caching lives in the semantic query cache
 * (`@hypequery/datasets`) and the query-builder cache
 * (`@hypequery/clickhouse`). This module aggregates their stats/clear
 * surfaces per layer so the playground gateway can serve
 * `GET /__dev/cache` → `{ layers: [...] }` without a serve-layer cache.
 */

import type { DatasetClient } from "@hypequery/datasets";

/** Stats snapshot for one cache layer. Layer ids are additive over time. */
export interface CacheLayerStats {
  layer: "semantic" | "builder";
  /** Layer-specific counters; shapes intentionally differ per layer. */
  stats: Record<string, unknown>;
  /** Whether `clear()` can clear this layer. */
  clearSupported: boolean;
}

export interface CacheObservability {
  /** Stats for every observable cache layer; empty when none are wired. */
  getStats(): Promise<CacheLayerStats[]>;
  /**
   * Clears the given layer, or every clearable layer when omitted. Returns
   * the ids of layers actually cleared — callers advertising a clear
   * affordance (the gateway's `cache:clear` capability) should first check
   * `clearSupported` on `getStats()`.
   */
  clear(layer?: string): Promise<{ cleared: string[] }>;
}

/**
 * The structural surface of `@hypequery/clickhouse`'s `CacheController`,
 * carried as `.cache` on every `createQueryBuilder()` result. Kept
 * structural so serve does not depend on the clickhouse package.
 */
export interface BuilderCacheLike {
  getStats(): Record<string, unknown>;
  clear(): Promise<void>;
}

/**
 * Detects a builder cache controller on a query-builder object. Builders
 * from `createQueryBuilder()` expose it as `.cache`; custom adapters without
 * one simply report no builder layer.
 */
export const detectBuilderCache = (candidate: unknown): BuilderCacheLike | undefined => {
  if (!candidate || typeof candidate !== "object") return undefined;
  const cache = (candidate as { cache?: unknown }).cache;
  if (
    cache &&
    typeof cache === "object" &&
    typeof (cache as BuilderCacheLike).getStats === "function" &&
    typeof (cache as BuilderCacheLike).clear === "function"
  ) {
    return cache as BuilderCacheLike;
  }
  return undefined;
};

/**
 * Sources are lazy: the shared dataset client is created on first semantic
 * endpoint registration, so layers are resolved per call, not at build time.
 */
export const createCacheObservability = (sources: {
  getSemanticClient?: () => Pick<DatasetClient, "getCacheStats" | "clearCache"> | undefined;
  getBuilderCache?: () => BuilderCacheLike | undefined;
}): CacheObservability => {
  const resolveLayers = () => {
    const layers: Array<{
      layer: CacheLayerStats["layer"];
      getStats: () => CacheLayerStats;
      clear: () => Promise<boolean>;
    }> = [];

    const semantic = sources.getSemanticClient?.();
    if (semantic) {
      layers.push({
        layer: "semantic",
        getStats: () => {
          const { clearSupported, ...stats } = semantic.getCacheStats();
          return { layer: "semantic", stats, clearSupported };
        },
        clear: () => semantic.clearCache(),
      });
    }

    const builder = sources.getBuilderCache?.();
    if (builder) {
      layers.push({
        layer: "builder",
        getStats: () => ({ layer: "builder", stats: builder.getStats(), clearSupported: true }),
        clear: async () => {
          await builder.clear();
          return true;
        },
      });
    }

    return layers;
  };

  return {
    async getStats() {
      return resolveLayers().map((layer) => layer.getStats());
    },
    async clear(layer) {
      const cleared: string[] = [];
      for (const candidate of resolveLayers()) {
        if (layer !== undefined && candidate.layer !== layer) continue;
        if (await candidate.clear()) {
          cleared.push(candidate.layer);
        }
      }
      return { cleared };
    },
  };
};
