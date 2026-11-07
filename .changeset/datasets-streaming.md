---
"@hypequery/datasets": minor
---

Stream dataset and metric results. `createDatasetClient(...).stream(target, query, context)` returns `{ data, meta }`, where `data` is a `ReadableStream` of row batches with the same row types and wire values as `execute()`, so memory stays flat however many rows there are. `streamArrow(target, query, context)` returns the result as Arrow IPC stream bytes with native column types. Both apply the same validation and tenant scoping as `execute()`. Their row ceiling is `limits.maxResultSize`, or the new `limits.maxStreamRows` where a dataset declares one, so exports can be allowed more rows than pages and agents; `meta.resultLimit` reports when the ceiling bounded a query. Streams skip the result cache and report no pagination. They need `@hypequery/clickhouse` 2.15.0 or later; the query builder protocol gains optional `stream`, `streamArrow`, `rawStream` and `rawArrowStream` methods.
