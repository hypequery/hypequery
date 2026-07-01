# @hypequery/datasets

## 0.4.0

### Minor Changes

- 12ee5e6: Add a stable, hashable semantic contract export.

  `@hypequery/datasets`:

  - Add `serializeSemanticContract`, `contractToStableJson`, `hashContract`, and `SEMANTIC_CONTRACT_VERSION`. The contract is a deterministic, sorted projection of the dataset catalog (dimensions, measures, metrics, filters, relationships, tenant/time policy, limits) with a version marker and SHA-256 content hash, so logically equal models produce identical JSON and hashes. This is the shared source for snapshots, diffs, CI validation, docs, and codegen.
  - `serializeSemanticContract` accepts `{ includeSql }` (default `true`) to omit raw SQL escape hatches for untrusted consumers.
  - Export the `DatasetCatalogSource` type.
  - Adds a dependency on `@noble/hashes` for the contract content hash, keeping the package isomorphic (no `node:crypto`).

  `@hypequery/serve`:

  - Expose the contract via a `GET /contract` endpoint (configurable through `semanticPaths.contract`) that serializes the registered datasets with their named metrics grouped onto each dataset. Raw SQL is redacted on this public endpoint by default.

## 0.3.0

### Minor Changes

- 236ce16: Add catalog-backed semantic tool generation and harden SQL exposure across MCP and generated tools.

  `@hypequery/datasets`:

  - Add `generateDatasetTools` with `catalog`, `per-dataset`, and `per-metric` modes, plus `toOpenAITools`, `toAISDKTools`, and `toMcpTools` adapters. Generated tools validate agent inputs against catalog metadata and redact SQL from results by default.
  - Expand the dataset catalog with default filter operators, filter value types, supported time grains, tenant requirement, orderable fields, max result limit, and measure filter counts.
  - Export `SEMANTIC_FILTER_OPERATORS` and `SUPPORTED_TIME_GRAINS` and use the shared operator list across packages.

  `@hypequery/serve`:

  - Build semantic input schemas and endpoint descriptions from catalog metadata, including supported grains, filters, relationships, and tenant scoping.

  `@hypequery/mcp`:

  - Distinguish measures from named metrics in dataset listing and introspection (`metricCount` no longer falls back to the measure count).
  - Add an `includeSql` server option (default `false`) so `get_dataset_schema`, `query_dataset`, and `query_metric` no longer expose generated SQL to agents unless explicitly enabled for trusted debugging.

## 0.2.1

### Patch Changes

- e6734be: Add dataset catalog metadata for measures, filters, relationships, limits, and attached named metrics. Update MCP dataset introspection and dataset querying metadata to distinguish measures from named metrics.

  Breaking MCP change: `query_dataset` now accepts `measures` only. The previous `metrics` argument for dataset queries has been removed so named metrics remain reserved for `query_metric`.

## 0.2.0

### Minor Changes

- 75349dd: Introduce the unified semantic dataset client and execution architecture.

  `createDatasetClient` now executes both datasets and metrics through either the
  query-builder protocol or a database-specific semantic backend. The package
  adds neutral semantic plans, an in-memory backend, dataset query execution,
  derived-metric validation, and a public internal protocol export for adapters.

  Query validation now covers dataset limits, field/operator compatibility,
  derived metric grouping, pagination input, and supported time grains. Runtime
  tenant predicates are injected consistently, and attempts to override enforced
  tenant filters are rejected.

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

- 2f3c293: Thread dataset field types through the generated API type for typed React hooks.

  `@hypequery/datasets` now exports typed query/result helpers
  (`DatasetQueryFor`, `DatasetRow`, `DatasetQueryResultFor`, and the
  `DatasetDimensionNames`/`DatasetMeasureNames`/`DatasetOrderableNames` name
  helpers, plus the metric equivalents).

  `@hypequery/serve`'s `SemanticDatasetEndpointMap` now specializes each dataset
  endpoint to its concrete instance, so `InferAPIType` carries field-level types.
  With `@hypequery/react`, `useDataset(name, input)` gets autocomplete and
  type-checking for `dimensions`/`measures`/`orderBy`, and result rows are typed
  by the dataset's dimensions and measures.

  Metric endpoints remain on the loose `MetricQuery`/`MetricResult` types for now:
  `MetricRef` does not preserve its dataset's concrete dimension keys, so
  field-level metric typing requires threading the dataset generics through
  `MetricRef` — tracked as a follow-up.

- 278924e: Carry a metric's dataset type through `MetricRef` for field-level metric hooks.

  `MetricRef` / `GrainedMetricRef` / `MetricHandle` (and `BaseMetricRef` /
  `DerivedMetricRef`) gain an optional `TDataset` type parameter that defaults to
  the previous wide instance, so existing usages are unchanged. `DatasetInstance.metric()`
  now returns a ref carrying its dataset's concrete dimension/measure types.

  `@hypequery/serve`'s `SemanticMetricEndpointMap` uses this to specialize each
  metric endpoint, so via `@hypequery/react` `useMetric(name, input)` gets
  autocomplete and type-checking for `dimensions`/`orderBy`, and result rows are
  typed by the dataset's dimensions plus the metric's value column. This completes
  the typed-hooks work started for datasets; metric endpoints degrade gracefully to
  loose `string` fields when a ref has been widened.

### Patch Changes

- ad42b98: Fix three semantic-layer deviations surfaced by manual testing.

  - **SQL-backed measures now carry through metrics.** A metric built from a
    measure with a `sql` override (e.g. `measure.sum('amount', { sql: 'amount * 1.2' })`)
    previously dropped the override on the query-builder path, emitting a plain
    `SUM(amount)`. The override is now threaded through `AggregationSpec`, so the
    metric compiles to `SUM(amount * 1.2)` like the dataset path already did. The
    semantic (non-SQL) backend rejects such metrics with a clear error instead of
    silently ignoring the expression.
  - **Unsupported time grains are rejected.** `by: 'hour'` (or any grain outside
    `day | week | month | quarter | year`) now fails validation with
    `Unsupported time grain "hour"` instead of emitting `undefined(created_at)`.
    The planner also throws defensively if it ever receives an unknown grain.
  - **`quoteSQLIdentifier` uses ClickHouse backtick quoting** (`` `col` ``) rather
    than ANSI double quotes, escaping embedded backticks by doubling them.
