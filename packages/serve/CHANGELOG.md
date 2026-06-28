# @hypequery/serve

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
