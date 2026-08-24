# @hypequery/serve

## 0.15.5

### Patch Changes

- bd1548b: `api.manifest()` now reports routes registered with `api.route()` instead of the
  auto-generated convention route.

  `route()` registers the endpoint with the router but leaves `queryEntries`
  holding the auto-registered `/queries/<key>` entry, and `manifest()` read from
  `queryEntries`. So an endpoint registered as:

  ```ts
  api.route("/busiest-routes", api.queries.busiestRoutes, { method: "POST" });
  ```

  appeared in the manifest — and therefore in `hypequery generate:manifest` output
  — as `GET /queries/busiestRoutes`. `@hypequery/react` follows the manifest, so
  `useQuery('busiestRoutes', { limit: 8 })` issued a GET the server rejected with a
  400 rather than calling the POST route the author declared.

  Both routes remain live; the manifest can only name one, and it now names the
  explicit registration. When an endpoint is routed more than once the first
  registration wins, so regenerating the manifest is deterministic.

## 0.15.4

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

- Updated dependencies [8d08644]
  - @hypequery/datasets@0.13.5

## 0.15.3

### Patch Changes

- Updated dependencies [920878a]
- Updated dependencies [643abff]
  - @hypequery/protocol@0.11.0
  - @hypequery/datasets@0.13.4

## 0.15.2

### Patch Changes

- e370da0: Refresh every npm package page with a concise README and complete HypeQuery homepage and repository metadata.
- Updated dependencies [e370da0]
  - @hypequery/datasets@0.13.3
  - @hypequery/protocol@0.10.2

## 0.15.1

### Patch Changes

- 43c4f7a: Reject credentialed CORS configurations without an explicit origin allowlist.

## 0.15.0

### Minor Changes

- 225cba9: Allow trusted in-process hosts to provide an already-authenticated principal to
  Serve execution, and forward that principal through deployment runtime
  artifacts while retaining role, scope, and tenant enforcement.

  `api.execute()` (and `client()` / `run()`) now accept a `trustedAuth` option.
  Supplying it skips credential parsing only; required roles and scopes, tenant
  extraction, the context factory, validation, middleware, hooks, and
  `cache-control: no-store` all still apply. It is unreachable from the HTTP
  handler, so a network caller cannot set it. Pass `null` or omit it to fall
  through to the configured auth strategies.

  Because the principal is what authorization ran against, the pipeline now owns
  `ctx.auth` and `ctx.tenantId`. Two behavior changes follow:

  - A caller-supplied `context` containing `auth` or `tenantId` is rejected with a
    `VALIDATION_ERROR` instead of being merged over the authenticated principal.
  - A context factory returning `auth` no longer replaces the authenticated
    principal on `ctx.auth`.

  Deployment runtime artifacts refuse a `trustedAuth` argument when the bundled
  module exposes no Serve `execute()` pipeline, rather than running the handler
  with no enforcement.

## 0.14.1

### Patch Changes

- Updated dependencies [24e0bd5]
  - @hypequery/protocol@0.10.0
  - @hypequery/datasets@0.13.2

## 0.14.0

### Minor Changes

- 02706c1: Harden request-ID handling: authoritative id is now server-generated (R0-04).

  The `x-request-id` on responses and in logs is always a server-generated authoritative
  identifier and is never derived from client input. A caller-supplied `x-request-id` or
  `x-trace-id` is validated (control characters rejected, bounded to 200 UTF-8 bytes) and
  surfaced only as a separate, non-authoritative `x-correlation-id` response header. This
  closes a path where a client could inject control characters into logs/headers or spoof
  cross-request correlation via the authoritative id.

  Additive and non-breaking to the API surface: `x-request-id` is still present on every
  response; only its value changes from an echoed client header to a trusted server id, with
  the validated client value preserved under `x-correlation-id`.

## 0.13.7

### Patch Changes

- Updated dependencies [05ebed8]
  - @hypequery/datasets@0.13.0

## 0.13.6

### Patch Changes

- Updated dependencies [04abd3c]
  - @hypequery/protocol@0.9.0
  - @hypequery/datasets@0.12.7

## 0.13.5

### Patch Changes

- Updated dependencies [7097da6]
  - @hypequery/protocol@0.8.0
  - @hypequery/datasets@0.12.6

## 0.13.4

### Patch Changes

- Updated dependencies [9a8ac57]
  - @hypequery/protocol@0.7.0
  - @hypequery/datasets@0.12.5

## 0.13.3

### Patch Changes

- Updated dependencies [268818b]
  - @hypequery/protocol@0.6.0
  - @hypequery/datasets@0.12.4

## 0.13.2

### Patch Changes

- Updated dependencies [3a8cad6]
  - @hypequery/protocol@0.5.0
  - @hypequery/datasets@0.12.3

## 0.13.1

### Patch Changes

- Updated dependencies [b92a0a1]
  - @hypequery/protocol@0.4.0
  - @hypequery/datasets@0.12.2

## 0.13.0

### Minor Changes

- 303d402: Normalize auth overrides across queries, datasets, and metrics. Semantic entries
  with `auth: null` now continue to inherit global auth; use
  `requiresAuth: false` to make a dataset or metric endpoint explicitly public.

  Compatibility note: semantic endpoints that previously used `auth: null` as a
  public override must migrate to `requiresAuth: false`. This breaking behavior
  change ships as a minor deliberately because `@hypequery/serve` is 0.x, where
  breaking changes use the minor version slot.

### Patch Changes

- fdec655: Build deterministic Node runtime artifacts automatically when deployment metadata references Serve handlers.

## 0.12.0

### Minor Changes

- 05d2a4d: Add canonical deployment contract encoding and domain-separated identities, expose deployment generation on Serve APIs, and add CLI build and validation commands for deployment artifacts.

### Patch Changes

- Updated dependencies [05d2a4d]
  - @hypequery/protocol@0.3.0
  - @hypequery/datasets@0.12.1

## 0.11.0

### Minor Changes

- 28e998f: Add the portable Dataset deployment contract, strict protocol validation, and
  Dataset/Serve adapters for producing deployment artifacts from existing
  definitions.

### Patch Changes

- Updated dependencies [28e998f]
  - @hypequery/protocol@0.2.0
  - @hypequery/datasets@0.12.0

## 0.10.0

### Minor Changes

- 42041fc: Add `cacheObservability` to `createAPI()`/`defineServe()` results and to `DevIntegrationApi`: per-layer stats and clear for the semantic query cache and the query-builder cache (serve itself holds no cache). The builder layer is detected structurally — query builders created by `createQueryBuilder()` expose their `CacheController` as `.cache` and are picked up automatically; bare factories simply report no builder layer. `getStats()` returns an empty layer list until a semantic endpoint or cache-capable builder is registered. Consumers advertising clear affordances (e.g. the playground gateway's `cache:clear` capability) should check each layer's `clearSupported`.

  Compatibility note: `cacheObservability` is a required member of the exported `HypeQueryAPI`/`ServeBuilder`/`DevIntegrationApi` interfaces (0.x minor, same policy as `@hypequery/datasets` 0.11): hand-rolled implementations must add it — `createCacheObservability({})` provides an empty aggregator.

## 0.9.2

### Patch Changes

- Updated dependencies [a84beb8]
  - @hypequery/datasets@0.11.0

## 0.9.1

### Patch Changes

- Updated dependencies [379998a]
  - @hypequery/datasets@0.10.0

## 0.9.0

### Minor Changes

- b6b5111: Relationship-aware semantics: to-one relationships are now queryable end to end, and every metadata surface advertises them.

  **Querying (`@hypequery/datasets`, `@hypequery/clickhouse`):** dataset and metric queries can select, filter, and order by to-one related fields one hop deep (`dimensions: ['customer.country']`). Traversal executes as a ClickHouse `LEFT ANY JOIN` (new `leftAnyJoin` query-builder method), so base rows survive, duplicate target join keys can never fan out aggregates, and production matches the in-memory backend's first-match semantics. When runtime tenancy is active, joined targets with a `tenantKey` are scoped inside the join condition. `hasMany` remains metadata-only, and result row types include qualified fields (`row['customer.country']` is typed).

  **Metadata:** the catalog and semantic contract expose `queryable` and `fields` per relationship (replacing `execution: 'metadata_only'`; `SEMANTIC_CONTRACT_VERSION` is now 2). Generated agent tools, Serve's Zod/OpenAPI input schemas, and MCP `get_dataset_schema` all advertise the same qualified field names the validators accept — including for config-shaped datasets in MCP. Serve no longer advertises dimensions as filterable when a dataset explicitly declares `filters: {}`.

  **Validation:** `dataset()` now rejects relationship names that match the dataset's source table (the join alias would shadow the base table) or contain dots — both configurations previously failed confusingly at query time.

  **Deprecations (no removals, no behavior changes):** the plan/backend execution path is frozen in favor of `createDatasetClient({ queryBuilder })`. `createBackend`, the `backend` client option, `createInMemoryBackend`, and the `PlanNode`/`SemanticBackend` protocol exports are `@deprecated` and receive bug fixes only.

### Patch Changes

- Updated dependencies [b6b5111]
  - @hypequery/datasets@0.9.0

## 0.8.1

### Patch Changes

- 688a9e2: Harden logging and diagnostics without changing public APIs: never mark
  authenticated or tenant-aware responses as publicly cacheable, log the
  parameterized SQL template instead of a value-substituted string, and redact
  connection URLs in CLI output and error messages.

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

### Patch Changes

- Updated dependencies [53f6149]
  - @hypequery/datasets@0.8.0

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

### Patch Changes

- Updated dependencies [4fed0a7]
  - @hypequery/datasets@0.7.0

## 0.6.1

### Patch Changes

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

- Updated dependencies [98ad4b6]
  - @hypequery/datasets@0.6.0

## 0.6.0

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

### Patch Changes

- 5cec806: Make `context` optional in `initServe`, matching the runtime (which already
  defaults a missing context to `{}`) and the documented auth-only usage. When
  omitted, query context is typed as `Record<string, unknown>`.
- Updated dependencies [d7259f0]
  - @hypequery/datasets@0.5.0

## 0.5.0

### Minor Changes

- 12ee5e6: Add a stable, hashable semantic contract export.

  `@hypequery/datasets`:

  - Add `serializeSemanticContract`, `contractToStableJson`, `hashContract`, and `SEMANTIC_CONTRACT_VERSION`. The contract is a deterministic, sorted projection of the dataset catalog (dimensions, measures, metrics, filters, relationships, tenant/time policy, limits) with a version marker and SHA-256 content hash, so logically equal models produce identical JSON and hashes. This is the shared source for snapshots, diffs, CI validation, docs, and codegen.
  - `serializeSemanticContract` accepts `{ includeSql }` (default `true`) to omit raw SQL escape hatches for untrusted consumers.
  - Export the `DatasetCatalogSource` type.
  - Adds a dependency on `@noble/hashes` for the contract content hash, keeping the package isomorphic (no `node:crypto`).

  `@hypequery/serve`:

  - Expose the contract via a `GET /contract` endpoint (configurable through `semanticPaths.contract`) that serializes the registered datasets with their named metrics grouped onto each dataset. Raw SQL is redacted on this public endpoint by default.

### Patch Changes

- Updated dependencies [12ee5e6]
  - @hypequery/datasets@0.4.0

## 0.4.0

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

### Patch Changes

- Updated dependencies [236ce16]
  - @hypequery/datasets@0.3.0

## 0.3.0

### Minor Changes

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

- 2c1425f: Generate per-dataset/per-metric request schemas with enumerated fields.

  Metric and dataset endpoints previously typed their request body as
  `dimensions: string[]` / `filters[].field: string`, so the OpenAPI spec (and
  `hypequery dev` docs) advertised "array of arbitrary strings" and clients could
  not be code-generated with valid field names.

  Endpoints now build their Zod input schema from the dataset/metric contract:
  `dimensions`, `measures`, `filters[].field`, and `orderBy[].field` are emitted as
  enums of the valid field names, and array sizes are bounded by the dataset's
  declared `limits`. The enums are a superset-safe mirror of the runtime
  validators — they never reject a field the validator would accept — so behavior
  is unchanged while docs and codegen become precise.

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

- 75349dd: Add first-class semantic APIs and production authentication primitives to the
  Serve runtime.

  - `createAPI` and the builder can register datasets and metrics backed by the
    unified dataset client, execute them programmatically, expose typed HTTP
    endpoints, and carry semantic metadata through caching and lifecycle hooks.
  - Add standalone Node and Fetch adapters plus reusable API builder methods for
    composing and describing an API.
  - Add context authentication, remote JWKS verification, analytics token
    issuance, and configurable auth paths for separating browser authentication
    from analytics endpoints.
  - Wire configured CORS behavior through `createAPI`, including preflight and
    response headers.

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

- Updated dependencies [ad42b98]
- Updated dependencies [75349dd]
- Updated dependencies [69b67c0]
- Updated dependencies [2f3c293]
- Updated dependencies [278924e]
  - @hypequery/datasets@0.2.0

## 0.2.1

### Patch Changes

- de7f4b4: Security update: upgrade openapi-typescript dependency from 7.4.2 to 7.13.0 to resolve high-severity fast-uri vulnerabilities (CVE path traversal and host confusion issues).

## 0.2.0

### Minor Changes

- 66a6ca4: Expand the current object-style `query({ ... })` API so runtime auth and tenant metadata work the same way as the older builder-first flow.

  - support `auth`, `requiresAuth`, `tenant`, `requiredRoles`, `requiredScopes`, and `custom` directly on object-style query definitions
  - preserve that metadata on standalone queries created via `query({ ... })` so it survives when reused through `serve({ queries })`
  - enforce object-style auth requirements and public routes through the serve runtime
  - include object-style auth metadata in endpoint descriptions and runtime inspection output
  - apply object-style tenant overrides through the serve runtime

  This brings the object-style API closer to feature parity with the builder-first serve path and makes it the clearer default for new integrations.

## 0.1.1

### Patch Changes

- 5c60f20: Add getHeader and apiKeyAuth helpers for header-based auth, plus structured auth errors for missing/invalid credentials.

## 0.1.0

### Minor Changes

- e15ce16: Add per-request header resolvers to React hooks and improve serve multi-tenant ergonomics, ESM-safe startup, and docs alignment.

### Patch Changes

- ed06077: Ensure the release workflow builds every package before running the Changesets publish step so the CI release ships with fresh `dist` artifacts.

## 0.0.9

### Patch Changes

- Republish so CI builds `dist` output before publishing and the package ships compiled files.

## 0.1.0

### Minor Changes

- 3a2aaea: Implement auth guard enhancements with type-safe authorization. Add `createAuthSystem` for compile-time role/scope safety, shared authorization validators (`checkRoleAuthorization`, `checkScopeAuthorization`), comprehensive integration tests, and OpenAPI documentation for auth requirements. Mark middleware functions (`requireAuthMiddleware`, `requireRoleMiddleware`, `requireScopeMiddleware`) as deprecated in favor of the declarative guard API.

## 0.0.7

### Patch Changes

- 4bbab53: Enable query execution stats logging in dev server. Removed "Coming soon!" placeholder as the feature is already implemented via `serveDev`.

## 0.0.6

### Patch Changes

- 5acbaf3: Fix validation for queries with void input schema.

  The `buildContextInput` function now correctly returns `undefined` instead of an empty object `{}` for requests with no body or query parameters. This fixes a bug where queries using `z.void()` input validation would fail with "Expected void, received object" errors.

  **Changes:**

  - Fixed `buildContextInput` in `pipeline.ts` to return `undefined` for empty requests
  - Added test to prevent future regressions
  - Updated vite-starter example to display validation errors in UI

## 0.0.4

### Patch Changes

- f99e80e: Pre-release improvements:
  - CLI loading spinners, serve runtime fixes, and React integration updates
