---
"@hypequery/datasets": minor
---

Add cache observability to the semantic query cache: `SemanticQueryCache.getStats()` (hit/miss/stale counters, hit rate, clear support) and `clear()`, exposed on `DatasetClient` as `getCacheStats()` and `clearCache()`. Counters are per client instance; bypassed calls are not counted.
