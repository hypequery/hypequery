---
"@hypequery/serve": minor
"@hypequery/datasets": patch
---

Cache scopes for serve endpoints doing per-request warehouse routing.

Middleware can now keep entry-level result caching enabled when it routes a
request to a different data source: `attachSemanticRuntime(ctx, {
builderFactory, cacheScope })` partitions cache entries per source, and
`attachSemanticCacheScope(ctx, scope)` partitions without overriding the
builder. Both helpers (plus `attachSemanticQueryBuilder`,
`attachSemanticTenantRuntime`, `resolveSemanticExecutionRuntime`, and
`resolveSemanticCacheScope`) are now exported from `@hypequery/serve`.

Semantic endpoints no longer forward the API's own query builder as a
per-call `runtime.builderFactory` override on every execution — only genuine
middleware overrides reach the dataset client, so caching no longer depends
on object identity between the serve config and the shared client.

`@hypequery/datasets` logs a one-time warning when caching is configured but
bypassed because a call overrides `runtime.builderFactory` without setting
`cache.scope`, so a silently disabled cache does not go undiagnosed.
