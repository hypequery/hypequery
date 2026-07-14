import { describe, expect, it, vi } from "vitest";

import {
  createCacheObservability,
  detectBuilderCache,
  type BuilderCacheLike,
} from "./cache-observability.js";

const makeSemanticClient = (overrides: { clearSupported?: boolean } = {}) => ({
  getCacheStats: vi.fn(() => ({
    hits: 3,
    misses: 1,
    staleHits: 0,
    hitRate: 0.75,
    clearSupported: overrides.clearSupported ?? true,
  })),
  clearCache: vi.fn(async () => overrides.clearSupported ?? true),
});

const makeBuilderCache = (): BuilderCacheLike & { clear: ReturnType<typeof vi.fn> } => ({
  getStats: vi.fn(() => ({ hits: 5, misses: 2, staleHits: 0, revalidations: 1, hitRate: 5 / 7 })),
  clear: vi.fn(async () => undefined),
});

describe("detectBuilderCache", () => {
  it("detects the cache controller on createQueryBuilder-shaped objects", () => {
    const cache = makeBuilderCache();
    expect(detectBuilderCache({ cache, table: () => ({}) })).toBe(cache);
  });

  it("returns undefined for bare factories and malformed cache members", () => {
    expect(detectBuilderCache(undefined)).toBeUndefined();
    expect(detectBuilderCache({ table: () => ({}), rawQuery: async () => [] })).toBeUndefined();
    expect(detectBuilderCache({ cache: {} })).toBeUndefined();
    expect(detectBuilderCache({ cache: { getStats: () => ({}) } })).toBeUndefined();
  });
});

describe("createCacheObservability", () => {
  it("reports no layers when nothing is wired", async () => {
    const observability = createCacheObservability({});

    await expect(observability.getStats()).resolves.toEqual([]);
    await expect(observability.clear()).resolves.toEqual({ cleared: [] });
  });

  it("reports both layers with their own stats shapes", async () => {
    const semantic = makeSemanticClient();
    const builder = makeBuilderCache();
    const observability = createCacheObservability({
      getSemanticClient: () => semantic,
      getBuilderCache: () => builder,
    });

    const layers = await observability.getStats();

    expect(layers).toEqual([
      {
        layer: "semantic",
        stats: { hits: 3, misses: 1, staleHits: 0, hitRate: 0.75 },
        clearSupported: true,
      },
      {
        layer: "builder",
        stats: { hits: 5, misses: 2, staleHits: 0, revalidations: 1, hitRate: 5 / 7 },
        clearSupported: true,
      },
    ]);
  });

  it("resolves sources lazily so late-created clients are observed", async () => {
    const holder: { client?: ReturnType<typeof makeSemanticClient> } = {};
    const observability = createCacheObservability({
      getSemanticClient: () => holder.client,
    });

    await expect(observability.getStats()).resolves.toEqual([]);
    holder.client = makeSemanticClient();
    await expect(observability.getStats()).resolves.toHaveLength(1);
  });

  it("clears all clearable layers when no layer is named", async () => {
    const semantic = makeSemanticClient();
    const builder = makeBuilderCache();
    const observability = createCacheObservability({
      getSemanticClient: () => semantic,
      getBuilderCache: () => builder,
    });

    await expect(observability.clear()).resolves.toEqual({ cleared: ["semantic", "builder"] });
    expect(semantic.clearCache).toHaveBeenCalledOnce();
    expect(builder.clear).toHaveBeenCalledOnce();
  });

  it("clears only the named layer", async () => {
    const semantic = makeSemanticClient();
    const builder = makeBuilderCache();
    const observability = createCacheObservability({
      getSemanticClient: () => semantic,
      getBuilderCache: () => builder,
    });

    await expect(observability.clear("builder")).resolves.toEqual({ cleared: ["builder"] });
    expect(semantic.clearCache).not.toHaveBeenCalled();
  });

  it("omits layers whose clear is unsupported from the cleared list", async () => {
    const semantic = makeSemanticClient({ clearSupported: false });
    const observability = createCacheObservability({
      getSemanticClient: () => semantic,
    });

    const [layer] = await observability.getStats();
    expect(layer.clearSupported).toBe(false);
    await expect(observability.clear()).resolves.toEqual({ cleared: [] });
  });

  it("returns an empty cleared list for unknown layer names", async () => {
    const observability = createCacheObservability({
      getSemanticClient: () => makeSemanticClient(),
    });

    await expect(observability.clear("nope")).resolves.toEqual({ cleared: [] });
  });
});
