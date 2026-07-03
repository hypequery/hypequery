---
"@hypequery/datasets": minor
"@hypequery/serve": minor
---

Semantic query result caching keyed by the query signature.

`createDatasetClient` accepts `cache: { ttlMs, staleWhileRevalidateMs, maxEntries, store }`;
results are keyed by the canonical query signature (target, dimensions,
measures, filters, ordering, pagination, grain, and tenant scope), so
different queries never share entries and tenant-scoped datasets are
partitioned per tenant. Per-call controls via `ExecutionContext.cache`
(`{ ttlMs }` to opt in, `false` to bypass, `mode: 'refresh'` to force).
Errors are never cached, concurrent identical queries share one execution,
and hits carry `meta.cache = { hit, ageMs, stale? }`.

Serve metric and dataset entries with a `cache` value now cache results
server-side with that TTL (previously the value only emitted `Cache-Control`
headers, which POST semantic endpoints cannot use). Dataset endpoints now
execute through the shared `DatasetClient`, so metric and dataset entries
share one result cache per API.
