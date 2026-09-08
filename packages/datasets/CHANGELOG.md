# @hypequery/datasets

## 0.15.0

### Minor Changes

- f639bd4: Carry a derived metric's authored formula in the deployment contract, so derived
  metrics execute portably instead of failing closed.

  A derived metric's contract expression already stated what the metric means: it
  inlines each input's aggregate where the formula named it. What it dropped were
  the aliases. Those are not cosmetic — they become the column names of the
  intermediate aggregate and are referenced by the outer select, so a catalog
  rebuilt without them computes the same number through different SQL. Decision
  0005 excludes a surface that cannot be made byte-identical, which is why
  `CORE-12` refused derived metrics rather than approximating them.

  `ProtocolDatasetMetric` gains an optional `derivation` carrying the inputs under
  their aliases and the formula written in terms of them. It is additive: a
  contract produced before this field stays valid, and simply remains
  non-portable. Validation proves the two forms describe one formula —
  substituting the inputs back into the authored form must reproduce the inlined
  one exactly — so they cannot disagree silently. Inputs are ordered, not sorted,
  because each becomes a column of the intermediate result in that order.

  A derivation is also held to the grammar a formula can be rebuilt from, which is
  narrower than RFC 0003: arithmetic over references and the five formula
  functions, with a literal only as a `round` precision or a `coalesce` fallback.
  Accepting a comparison, or a one-argument `round`, would publish a contract that
  validates and then fails at the point of use. Eligibility follows the metric's
  expression rather than its `kind`, because `kind` reports `grained-metric` for
  both a base metric pinned to a grain and a derived one.

  `rehydrateProtocolDatasets` rebuilds the formula by calling the same helpers in
  `formulas.ts` that authored it, rather than compiling the expression to SQL a
  second time. Those helpers carry the `toSQL` closures that decide spacing,
  parenthesisation, and function spelling, so byte-identity is structural rather
  than reimplemented and cannot drift.

  The `CORE-16` equality harness now covers derived metrics across every axis it
  already generated — grouping, all five grains, filters, ordering, pagination,
  joins, and tenant predicates — over every formula helper, including a derived
  metric pinned to a grain, whose `kind` reports `grained-metric` rather than
  `derived-metric`. A metric whose contract omits the formula still fails closed
  with `unsupported-capability`, in both rehydration and the portable executor.

- b0911ce: Add portable native execution of a semantic invocation (decision 0005).

  `createPortableSemanticExecutor()` in `@hypequery/datasets` resolves a dataset
  or metric from the validated active contract, rebuilds its catalog, and plans
  the query with the existing semantic planner. No customer module is loaded and
  no isolated runtime is required, so a bundle answers dataset and metric calls
  without a separately loaded MCP config. It applies the resolved tenant,
  propagates deadlines and cancellation to the database request, and byte-limits
  the result. A request the deadline aborts is reported as the budget it overran
  rather than as the driver's generic failure, so a caller can tell a query that
  ran out of time — worth retrying with less — from a broken or unreachable one.

  A resolved tenant that the rebuilt dataset has no field to scope by is refused
  before a query is built. That is the one failure that is otherwise silent: the
  runtime accepts the tenant, the planner emits no predicate, and the query reads
  every tenant while each layer believes tenancy was enforced. Contract validation
  already refuses to publish that shape, but the executor is exported on its own
  and typed structurally, so it cannot assume a caller went through the validator.

  A target portable execution cannot reproduce fails closed with
  `unsupported-capability` rather than being approximated — a derived metric,
  whose symbolic expression contract v1 does not carry until `CORE-17`. A single
  such metric no longer makes the rest of a deployment unexecutable:
  `rehydrateProtocolDatasets` gains `onUnsupportedMetric: 'skip'`, and the
  requested target is refused at the point of use instead.

  The deployment data plane now honours a failure category an injected executor
  claims for itself, from a fixed allow-list, so a capability gap is reported as
  one rather than as a broken query. A claim is granted by an explicit marker on
  the error rather than by its shape: a provider or library exception that happens
  to carry a generic `category` — a `not-found` from an HTTP client, say — cannot
  put its own message in front of a caller or decide whether the call is retried.
  An executor that claims nothing, that claims a category it may not (such as
  `forbidden`), or that never opted in, still reports `executor-failed` with the
  generic message. `PortableExecutionTenantError` joins the exported unsupported
  and budget errors that carry the marker.

  Deadline expiry and caller cancellation now settle execution independently of
  adapter cooperation while also aborting the underlying request. An adapter
  that ignores cancellation cannot return a successful response after the deadline
  or keep the invocation pending indefinitely.

- f72bba8: Add `queryableDatasets` to `buildCanonicalSemanticQuerySchemas` options: the
  datasets that may be named as a direct query target, defaulting to all of them.

  A dataset left out still contributes its metrics and can still be joined to; it
  is only withheld from the `query_dataset` schema. That split exists because a
  deployment contract authorizes a dataset and each of its metrics through
  separate endpoint policies, so a caller can be entitled to a metric on a dataset
  it may not query directly. Compiling one schema for both cases would either
  advertise a target the caller cannot use or hide a metric it can.

### Patch Changes

- Updated dependencies [f639bd4]
- Updated dependencies [0ba2fa6]
  - @hypequery/protocol@0.13.0

## 0.14.0

### Minor Changes

- 9289c14: Add a typed dataset publishing builder for attaching and aliasing named metrics without object spreading, and re-export it from Serve's dataset API.
- a061a60: Add `rehydrateProtocolDatasets()`, which rebuilds executable datasets from a
  validated deployment contract — the inverse of `buildProtocolDatasetContract`.
  This is what makes decision 0005's portable native execution possible: a runtime
  resolves a dataset from the active contract and plans with the existing semantic
  planner, loading no customer module.

  Rehydration routes through the public `dataset()` factory, so a rebuilt dataset
  is constructed by the same code path as an authored one. Contract → catalog →
  contract is an identity, and a rebuilt registry projects the same agent-safe
  catalog as the contract it came from.

  A rebuilt metric is pinned to the dimensions, filters, and grains the contract
  declared rather than re-deriving them from the dataset, so rehydration cannot
  widen what a deployment published. Anything portable execution cannot rebuild —
  a derived metric, whose symbolic expression contract v1 does not carry — throws
  `UnsupportedContractFeatureError` instead of executing an approximation.

- 3689e0f: Enforce `limits.maxResultSize` for queries that set no limit of their own. Query validation already rejected a limit _above_ the ceiling, but both validators guard on `query.limit != null`, so an unbounded query skipped the ceiling entirely and streamed whatever the table held. A ceiling that only binds callers who happened to name a limit is not a ceiling. Bounding is reported in `meta.resultLimit`, never applied silently — a caller who asked for everything and received 1,000 rows could not otherwise tell a bounded answer from a complete one.

  Add `cache` to `DatasetConfig`: a declared result-cache policy with `ttlMs` (the default when the caller and client supply none) and `maxTtlMs` (a ceiling on any caller- or client-supplied TTL, and on the stale-while-revalidate window layered on it). Whether a result is still-filling or already final is known by whoever defined the model, not by a caller three packages away. A call may still shorten the window or bypass the cache entirely; it can never extend one past `maxTtlMs`. The precedence rule mirrors `resolveCompiledDeadline` in `@hypequery/clickhouse`. `maxTtlMs` clamps the client-level default as well as call-level values, and bounds the _total_ servable age (`ttlMs + staleWhileRevalidateMs`) rather than each window separately. It is a ceiling, not a default: when no layer supplies a TTL, the result stays uncached.

- be0a850: Validate dataset definitions structurally when `dataset()` is called, instead of letting a malformed model fail on the first query that reaches the broken part of it. Datasets are normally defined at module scope, so an invalid one now fails at import — in the build, in CI, and in the first test that touches the module.

  `source`, `tenantKey`, `timeKey`, dimension columns and measure fields are checked as SQL identifiers, since each is interpolated into generated SQL. `tenantKey` matters most: it becomes a predicate on every query against a tenant-scoped dataset, and a typo previously constructed cleanly.

  Raw `sql` expressions on dimensions and measures are rejected when they carry a statement terminator or comment opener (`;`, `--`, `/*`), because the value is spliced into a larger expression. A declared `dependencies` entry the expression never references is also rejected — the definition would otherwise claim to read a column it does not read.

  Dimension and measure names are checked as identifiers too, since they appear in query inputs, generated tool schemas, and protocol artifacts. Previously a name was only checked indirectly, via the column it defaulted to, so the same bad name passed or failed depending on whether an explicit `column` was set.

  `limits` values must be positive integers.

- 3a28cf0: Enforce `groupable: false` in generated query schemas. A dimension declared
  non-groupable — typically one that exists only to back a measure — is no longer
  accepted as a `dimensions` or `orderBy` selection by `query_dataset` or
  `query_metric`. It previously passed schema validation even though the
  agent-safe catalog hid it, so a dataset advertised one set of dimensions and
  accepted another.

  This applies across a queryable relationship too: a target dimension marked
  non-groupable is no longer offered as `<relationship>.<dimension>` grouping key.

  Filterability is unaffected: a dimension that is filterable but not groupable
  remains usable as a filter field, locally and over a relationship.

- 916eef3: Propagate semantic query cancellation through the datasets client and ClickHouse
  semantic backend, and enforce MCP query deadlines and serialized-response byte
  ceilings with stable budget error classifications.
- 969bea6: Add bounded agent-oriented descriptions, examples, synonyms, formats, units, currency, timezone, freshness, ownership, sensitivity, and query defaults across dataset catalogs and deployment contracts.
- 3a28cf0: Add deterministic agent-safe catalog projections for local datasets and portable deployment contracts, with physical diagnostics isolated behind an explicitly authorized trusted-debug API.
- d347f89: Add a canonical catalog-derived semantic query schema compiler with shared Zod
  validators, JSON Schemas, exact field and operator constraints, bounded closed
  objects, and deterministic manifest hashing. Migrate Serve and MCP query schemas
  to the shared compiler.

### Patch Changes

- Updated dependencies [abd39a9]
- Updated dependencies [969bea6]
- Updated dependencies [7a1a5c6]
  - @hypequery/protocol@0.12.0

## 0.13.6

### Patch Changes

- 6c1bcb6: Normalize non-null dataset measure and metric results to strings across query-builder and in-memory execution, preserve SQL nulls, and update public result types to `string | null`.

## 0.13.5

### Patch Changes

- 8d08644: Declare `zod` as an optional peer dependency so package managers warn when a
  zod 4 install is hoisted over the zod 3 these packages build against.

  Both packages depend on `zod@^3` but declared no peer range, so
  `npm install @hypequery/serve zod` silently resolved zod 4 at the top level with
  no warning. The first `query({ input: z.object(...) })` then failed to compile
  with `Type 'ZodObject<...>' is missing the following properties from type
'ZodType<any, any, any>': _type, _parse, _getType, _getOrReturnCtx, and 7 more`,
  which gives no hint that a version mismatch is the cause.

  The peer is marked optional, so nothing breaks for consumers who never install
  zod directly. Quick Start now pins `zod@^3` in its install commands.

## 0.13.4

### Patch Changes

- Updated dependencies [920878a]
- Updated dependencies [643abff]
  - @hypequery/protocol@0.11.0

## 0.13.3

### Patch Changes

- e370da0: Refresh every npm package page with a concise README and complete HypeQuery homepage and repository metadata.
- Updated dependencies [e370da0]
  - @hypequery/protocol@0.10.2

## 0.13.2

### Patch Changes

- Updated dependencies [24e0bd5]
  - @hypequery/protocol@0.10.0

## 0.13.1

### Patch Changes

- f4be6bb: Fix tenant isolation when a tenant-less base dataset joins a tenant-scoped
  relationship target. Joined results are now partitioned per runtime tenant in
  the result cache, and queries that activate a tenant-scoped relationship must
  provide a runtime tenant or the explicit trusted cross-tenant scope. Queries
  that touch no tenant-scoped target continue to share cache entries as before.

## 0.13.0

### Minor Changes

- 05ebed8: Add a SQL portability compiler that parses the supported ClickHouse SQL-expression subset into RFC 0003 expression ASTs, returning source-located incompatibility issues for unsupported syntax with bounded input size, depth, and node limits.

## 0.12.7

### Patch Changes

- Updated dependencies [04abd3c]
  - @hypequery/protocol@0.9.0

## 0.12.6

### Patch Changes

- Updated dependencies [7097da6]
  - @hypequery/protocol@0.8.0

## 0.12.5

### Patch Changes

- Updated dependencies [9a8ac57]
  - @hypequery/protocol@0.7.0

## 0.12.4

### Patch Changes

- Updated dependencies [268818b]
  - @hypequery/protocol@0.6.0

## 0.12.3

### Patch Changes

- Updated dependencies [3a8cad6]
  - @hypequery/protocol@0.5.0

## 0.12.2

### Patch Changes

- Updated dependencies [b92a0a1]
  - @hypequery/protocol@0.4.0

## 0.12.1

### Patch Changes

- Updated dependencies [05d2a4d]
  - @hypequery/protocol@0.3.0

## 0.12.0

### Minor Changes

- 28e998f: Add the portable Dataset deployment contract, strict protocol validation, and
  Dataset/Serve adapters for producing deployment artifacts from existing
  definitions.

### Patch Changes

- Updated dependencies [28e998f]
  - @hypequery/protocol@0.2.0

## 0.11.0

### Minor Changes

- a84beb8: Add cache observability to the semantic query cache: `SemanticQueryCache.getStats()` (hit/miss/stale counters, hit rate, clear support) and `clear()`, exposed on `DatasetClient` as `getCacheStats()` and `clearCache()`. Counters are per client instance; bypassed calls are not counted.

  Compatibility note: `getCacheStats()` and `clearCache()` are **required** members of the exported `DatasetClient` interface. Clients created by `createDatasetClient` gain them automatically, but hand-rolled implementations or test doubles that `implements DatasetClient` must add both members (delegating to a `SemanticQueryCache`, or returning empty stats and `false`) to compile after upgrading. This ships as a minor deliberately: the package is 0.x, where interface-breaking additions land in the minor slot, and the members are not optional so consumers never have to guard against `undefined`.

## 0.10.0

### Minor Changes

- 379998a: Add analytical dataset measures for percentiles, medians, argMax/argMin, sample standard deviation, and sample variance. The measures execute through the ClickHouse builder, ClickHouse semantic backend, and in-memory backend, and are surfaced in dataset catalogs and semantic contracts.

## 0.9.0

### Minor Changes

- b6b5111: Relationship-aware semantics: to-one relationships are now queryable end to end, and every metadata surface advertises them.

  **Querying (`@hypequery/datasets`, `@hypequery/clickhouse`):** dataset and metric queries can select, filter, and order by to-one related fields one hop deep (`dimensions: ['customer.country']`). Traversal executes as a ClickHouse `LEFT ANY JOIN` (new `leftAnyJoin` query-builder method), so base rows survive, duplicate target join keys can never fan out aggregates, and production matches the in-memory backend's first-match semantics. When runtime tenancy is active, joined targets with a `tenantKey` are scoped inside the join condition. `hasMany` remains metadata-only, and result row types include qualified fields (`row['customer.country']` is typed).

  **Metadata:** the catalog and semantic contract expose `queryable` and `fields` per relationship (replacing `execution: 'metadata_only'`; `SEMANTIC_CONTRACT_VERSION` is now 2). Generated agent tools, Serve's Zod/OpenAPI input schemas, and MCP `get_dataset_schema` all advertise the same qualified field names the validators accept — including for config-shaped datasets in MCP. Serve no longer advertises dimensions as filterable when a dataset explicitly declares `filters: {}`.

  **Validation:** `dataset()` now rejects relationship names that match the dataset's source table (the join alias would shadow the base table) or contain dots — both configurations previously failed confusingly at query time.

  **Deprecations (no removals, no behavior changes):** the plan/backend execution path is frozen in favor of `createDatasetClient({ queryBuilder })`. `createBackend`, the `backend` client option, `createInMemoryBackend`, and the `PlanNode`/`SemanticBackend` protocol exports are `@deprecated` and receive bug fixes only.

## 0.8.0

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

## 0.7.0

### Minor Changes

- 4fed0a7: Semantic query result caching keyed by the query signature.

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

## 0.6.0

### Minor Changes

- 98ad4b6: Accept schema-typed query builders at semantic entry points without casts.

  `createQueryBuilder<Schema>` results narrow column parameters to literal
  unions, type `execute()` rows concretely, and overload `where`, so they could
  not structurally satisfy `QueryBuilderFactoryLike` — passing the documented
  `createDatasetClient({ queryBuilder: db })` / `createAPI({ queryBuilder: db })`
  pattern failed to compile for typed-schema users.

  Public acceptance points (`CreateDatasetClientOptions.queryBuilder`,
  `SemanticExecutionRuntime.builderFactory`, serve's `ServeConfig.queryBuilder`)
  now take the new `QueryBuilderFactoryInput`, which admits both protocol-shaped
  and schema-typed builders. The strict `QueryBuilderFactoryLike` remains the
  internal call contract; the exported `toQueryBuilderFactory` adapter converts
  between them.

## 0.5.0

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
