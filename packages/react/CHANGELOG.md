# @hypequery/react

## 0.5.1

### Patch Changes

- e370da0: Refresh every npm package page with a concise README and complete HypeQuery homepage and repository metadata.

## 0.5.0

### Minor Changes

- 53f6149: Type semantic query measure and metric values as `string` instead of `number`.

  ClickHouse serializes aggregate results (`UInt64`, `Decimal`, ...) as strings
  over JSON, and the query builder already types aggregation outputs as `string`.
  The dataset/metric result row types (`DatasetRow`, `DatasetRowFor`, `MetricRow`,
  `MetricRowFor`, and the `@hypequery/react` hook rows inferred through
  `@hypequery/serve`) previously typed those same values as `number`, so a typed
  row claimed `revenue: number` while the runtime handed back `"1234.56"`. The
  types now match runtime.

  `createInMemoryBackend` now serializes measure/metric values as strings too, so
  it stays a faithful double of the ClickHouse backend (values are still computed
  and ordered numerically — only the emitted columns are stringified).

  **Breaking (types only):** code that assigned a measure or metric value
  straight into a `number` — e.g. `const revenue: number = row.revenue` — will no
  longer compile. Parse at the edge instead: `Number(row.revenue)` (or
  `parseFloat`). Dimension values are unchanged; only aggregated measure/metric
  columns are affected.

## 0.4.0

### Minor Changes

- 8ada222: `useInfiniteDataset` and `useInfiniteMetric` now project page row types from
  the query input, matching `useDataset` / `useMetric`. Selected dimensions and
  measures (and `period` for grained queries) are typed on
  `data.pages[n].data[m]` instead of requiring casts, unselected fields are
  rejected, and infinite-query `options` (e.g. `select`) see the projected page
  type.

## 0.3.0

### Minor Changes

- d7259f0: Tighten semantic API type inference, add projection-aware dataset and metric result
  types, preserve projected rows through React analytics hooks, and add static manifest
  generation for Next.js clients.

  BREAKING (types only, no runtime change): dataset and metric result rows are now
  projection-typed. `DatasetQueryResultFor` / `MetricResultFor` rows — including the
  `output` types produced by `InferApiType` / `InferAPIType` and the result of
  `createDatasetClient().execute()` — no longer expose dimension keys or `period`
  unless the query selects them via `dimensions` / `by`. Code that read dimension
  fields off default (non-projected) result types must now pass the projection in
  the query it executes.

## 0.2.0

### Minor Changes

- 75349dd: Support authenticated request lifecycles in generated React hooks.

  The `headers` callback may now be asynchronous and is resolved for every
  request, allowing short-lived credentials to be supplied. A new
  `onUnauthorized` callback can refresh credentials after a 401 response; the
  request is then retried once with freshly resolved headers.

- e64d6f4: Add a route manifest to bridge serve and react for metric/dataset endpoints.

  `@hypequery/serve` now exposes `api.manifest()` (and `ServeBuilder.manifest()`),
  a serializable map of every query/metric/dataset key to its `{ method, path }`
  (full path, including the base path; datasets keyed as `dataset:<name>`).

  `@hypequery/react`'s `createHooks`/`createAnalyticsHooks` accept a `manifest`
  option to resolve client routes without importing server code into the bundle.
  This fixes metric/dataset hooks (POST routes whose paths differ from their map
  keys) silently defaulting to `GET {baseUrl}/{key}`. Hooks now also derive routes
  from a runtime `api` object via `api.manifest()`, and throw a clear error when a
  semantic (`dataset:`) key has no resolved route instead of calling the wrong URL.

- 69b67c0: Add offset pagination with reliable `hasMore` and infinite-query hooks.

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

  Metric endpoints now treat the page-size `limit` like dataset endpoints: a
  configurable `maxLimit` on the metric entry (defaulting to the dataset's
  `limits.maxResultSize`, else 1000), with over-limit requests **clamped** rather
  than rejected, and a default cap applied so a metric query is never unbounded.

## 0.1.1

### Patch Changes

- 5c60f20: Allow headers to return an empty object and ignore undefined values.

## 0.1.0

### Minor Changes

- e15ce16: Add per-request header resolvers to React hooks and improve serve multi-tenant ergonomics, ESM-safe startup, and docs alignment.

### Patch Changes

- ed06077: Ensure the release workflow builds every package before running the Changesets publish step so the CI release ships with fresh `dist` artifacts.
- 651f1c0: Ensure React package builds on publish by running `pnpm build` before packing and verifying required dist artifacts.

## 0.0.3

### Patch Changes

- Republish to ensure the release pipeline builds and ships compiled `dist` files.

## 0.0.2

### Patch Changes

- f99e80e: Pre-release improvements:
  - CLI loading spinners, serve runtime fixes, and React integration updates
