---
"@hypequery/datasets": minor
"@hypequery/serve": minor
---

Semantic query result caching keyed by the query signature.

`createDatasetClient` accepts `cache: { ttlMs, staleWhileRevalidateMs, maxEntries, store, scope }`;
results are keyed by the canonical query signature (target, dimensions,
measures, filters, ordering, pagination, grain, tenant scope, and cache
scope), so different queries never share entries and tenant-scoped datasets
are partitioned per tenant. Per-call controls via `ExecutionContext.cache`
(`{ ttlMs }` to opt in, `false` to bypass, `mode: 'refresh'` to force a
fresh execution and re-store). Errors are never cached, concurrent identical
queries share one execution — including against async stores — and hits
carry `meta.cache = { hit, ageMs, stale? }`.

Custom stores (e.g. Redis) degrade gracefully: a failed read is treated as
a miss and a failed write is dropped, so a store outage means "no caching",
never failed queries. `cache.scope` partitions entries when the same query
can run against different data sources — client-level for clients sharing
one store, per-call when overriding the query builder at runtime (unscoped
builder overrides skip the cache entirely).

Serve metric and dataset entries with a `cache` value now cache results
server-side with that TTL (previously the value only emitted `Cache-Control`
headers, which POST semantic endpoints cannot use). Dataset endpoints now
execute through the shared `DatasetClient`, so metric and dataset entries
share one result cache per API.
