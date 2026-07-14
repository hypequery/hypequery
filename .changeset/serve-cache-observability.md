---
"@hypequery/serve": minor
---

Add `cacheObservability` to `createAPI()`/`defineServe()` results and to `DevIntegrationApi`: per-layer stats and clear for the semantic query cache and the query-builder cache (serve itself holds no cache). The builder layer is detected structurally — query builders created by `createQueryBuilder()` expose their `CacheController` as `.cache` and are picked up automatically; bare factories simply report no builder layer. `getStats()` returns an empty layer list until a semantic endpoint or cache-capable builder is registered. Consumers advertising clear affordances (e.g. the playground gateway's `cache:clear` capability) should check each layer's `clearSupported`.

Compatibility note: `cacheObservability` is a required member of the exported `HypeQueryAPI`/`ServeBuilder`/`DevIntegrationApi` interfaces (0.x minor, same policy as `@hypequery/datasets` 0.11): hand-rolled implementations must add it — `createCacheObservability({})` provides an empty aggregator.
