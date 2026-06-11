---
"@hypequery/datasets": minor
"@hypequery/serve": minor
"@hypequery/react": minor
---

Add offset pagination with reliable `hasMore` and infinite-query hooks.

Metric and dataset queries that specify a `limit` now return
`meta.pagination = { limit, offset, hasMore }`. `hasMore` is exact: the executor
over-fetches one row (`LIMIT n + 1`) and trims it, so no separate count query is
needed. The extra field is included in the serve endpoints' OpenAPI response
schema (surfaced when meta is requested via `x-include-meta`).

`@hypequery/react` adds `useInfiniteQuery` (and `useInfiniteMetric` /
`useInfiniteDataset` on `createAnalyticsHooks`) built on TanStack Query's infinite
query. They advance the offset using `meta.pagination`, automatically requesting
meta, so paginating a dataset is just `fetchNextPage()` until `hasNextPage` is
false.
