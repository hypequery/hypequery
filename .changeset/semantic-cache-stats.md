---
"@hypequery/datasets": minor
---

Add cache observability to the semantic query cache: `SemanticQueryCache.getStats()` (hit/miss/stale counters, hit rate, clear support) and `clear()`, exposed on `DatasetClient` as `getCacheStats()` and `clearCache()`. Counters are per client instance; bypassed calls are not counted.

Compatibility note: `getCacheStats()` and `clearCache()` are **required** members of the exported `DatasetClient` interface. Clients created by `createDatasetClient` gain them automatically, but hand-rolled implementations or test doubles that `implements DatasetClient` must add both members (delegating to a `SemanticQueryCache`, or returning empty stats and `false`) to compile after upgrading. This ships as a minor deliberately: the package is 0.x, where interface-breaking additions land in the minor slot, and the members are not optional so consumers never have to guard against `undefined`.
