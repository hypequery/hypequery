# Plan: Production-Ready Datasets → Serve → React Integration

> Status: proposed. Source of analysis: `packages/datasets`, `packages/serve`, `packages/react`.
> Created 2026-06-11.

## Background / gap analysis

How it fits together today:

- `createAPI` / `defineServe` accept `metrics` and `datasets` config maps. Each metric
  becomes `POST {basePath}/metrics/{name}`; each dataset becomes
  `POST {basePath}/datasets/{name}/query` (`serve/src/server/create-api.ts:167-220`).
- Both are registered into `api.queries` under keys `name` (metrics) and `dataset:{name}`
  (datasets), so they appear in OpenAPI/docs and `InferAPIType`.
- React consumes the inferred type via `createHooks` / `createAnalyticsHooks`
  (`useMetric`, `useDataset`).

Identified gaps:

1. **Flexible API creation** — solid coverage (validation, tenant runtime, auth/roles/scopes,
   caching, max-limit clamp, meta gating). But semantic endpoints are second-class:
   `middlewares: []` and `defaultHeaders: undefined` are hardcoded
   (`metric-endpoint.ts`, `dataset-endpoint.ts`); no per-endpoint middleware/headers/rate-limit.
2. **Docs via `hypequery dev`** — request schema is untyped: `dimensions: z.array(z.string())`,
   `filters[].field: z.string()`, output `z.array(z.record(z.unknown()))`. Valid field names
   live only in the prose description, so OpenAPI advertises "array of arbitrary strings" and
   you cannot codegen a typed client.
3. **Flexible typed React hooks** — typed at the envelope, not the field.
   `SemanticMetricEndpointMap` / `SemanticDatasetEndpointMap` type every endpoint with generic
   `DatasetQuery` / `DatasetQueryResult` (`serve/src/types.ts:568-595`), so `useDataset` accepts
   any `string[]` and rows are `Record<string, unknown>`. **Bigger gap:** no generated route
   manifest — in a client/server split you import only `InferApiType`, so `deriveMethodConfig`
   finds nothing → defaults to `GET baseUrl/dataset:orders`, never the real
   `POST {basePath}/datasets/orders/query`. Even passing the runtime `api` fails because
   `deriveMethodConfig` reads `endpoint.path` while the value lives at `endpoint.metadata.path`
   (`react/src/createHooks.tsx:30-40`; every test hand-writes `config: {...}`).
4. **Pagination** — offset-only in body; `MetricResultMeta` is only `{ timingMs, sql, tenant }`
   (`datasets/src/types.ts:182`); no `hasMore`/total; React has only `useQuery`/`useMutation`;
   clickhouse builder has no cursor pagination.
5. **params vs body** — POST+body for semantic queries is the right call, but defeats
   CDN/browser caching despite server-side `cacheTtlMs`; meta is requested via the
   `x-include-meta` header side-channel (not in OpenAPI, not first-class in React).
6. **Auth** — good primitives (apiKey, bearer, roles/scopes, tenancy, CORS, pluggable
   rate-limit store) but no built-in JWT/JWKS verification, React auth is header-only with no
   refresh/401 retry, and the default rate-limit store is in-memory only.

---

## Phase 1 — Route manifest (kills the GET/path-drift footgun) [highest leverage]

Generate a serializable manifest at define time and let React consume it.

1. Add `api.manifest()` to `createAPI` (`server/api-builder.ts` / `create-api.ts`), sourced from
   `router.list()` (carries full basePath-applied paths). Shape:
   `Record<string, { method: HttpMethod; path: string }>` keyed by the same keys as `api.queries`
   (including `dataset:{name}` and metric names). Exclude internal endpoints (`/openapi.json`, `/docs`).
2. Export paths:
   - Server-only modules: `export const manifest = api.manifest()` (plain JSON, no server code in bundle).
   - CLI emit `hypequery client:manifest` → `hypequery.manifest.json` for pure SPAs.
3. React: add `manifest?: RouteManifest` to `CreateHooksConfig`. Resolution order in `fetchQuery`:
   `explicitConfig[name]` → `manifest[name]` → `deriveMethodConfig(api)` → defaults.
   Fix the `deriveMethodConfig` runtime-`api` branch to read `endpoint.metadata.path` / `endpoint.method`.
4. Throw a clear error when a `dataset:`-prefixed key resolves to no manifest/config entry instead of
   silently GETting `baseUrl/dataset:orders`.

Files: `serve/src/server/api-builder.ts`, `create-api.ts`, `serve/src/types.ts`,
`react/src/createHooks.tsx`, `packages/cli`. Tests: manifest snapshot; React resolves POST/path with no `config`.

## Phase 2 — Per-dataset Zod schemas with field enums [foundation]

Build the input schema per dataset/metric from the contract.

1. In `createDatasetEndpoint`, replace the shared `datasetQueryInputSchema` with a factory using
   `Object.keys(ds.dimensions)` / `Object.keys(ds.measures)` → `z.enum([...])` (fallback `z.string()`
   when empty). `filters[].field` / `orderBy[].field` = union of dim+measure enums. `by` only when a
   `timeKey` exists. Same for `createMetricEndpoint` from `contract.dimensions` / `contract.grains`.
2. Add `.max()` guards on `dimensions` / `measures` / `filters` arrays (payload-guard gap).
3. Keep `data` row output as `z.record(z.unknown())` (row typing is TS-level in Phase 3); add Phase 4
   meta fields to the output schema so OpenAPI documents them.
4. Watch-outs: empty-tuple `z.enum`; relationship-qualified field names (e.g. `orders.country`) must be
   in the enum list — mirror exactly what `validateDatasetQuery` accepts.

Files: `serve/src/semantic/datasets/dataset-endpoint.ts`, `metric-endpoint.ts`.

## Phase 3 — Field-level types in React hooks

Thread the dataset/metric generics through the endpoint map so `useDataset` / `useMetric` get
field-level autocomplete and typed rows.

1. Parameterize `SemanticDatasetEndpointMap` / `SemanticMetricEndpointMap` (`serve/src/types.ts`) with the
   concrete instance type per key. `DatasetQueryFor<DS>` narrows `dimensions` / `measures` to
   `DatasetFieldNames<DS>[]` / new `DatasetMeasureNames<DS>[]`; `DatasetRow<DS>` builds the row type.
2. `InferApiType` / `InferAPIType` already map `SchemaInput` / `SchemaOutput`, so hooks inherit types for free.
3. Source types from `DatasetInstance` (value types), type-level only — decoupled from Zod inference.

Files: `serve/src/types.ts`, `datasets/src/types.ts`. Tests: `react/type-tests/create-hooks.test-d.ts`.

## Phase 4 — Production-grade pagination

1. Extend meta (`datasets/src/types.ts`): `pagination?: { limit; offset; hasMore; total? }`. Populate by
   fetching `limit + 1` rows and trimming (reliable `hasMore`, no extra count query). Mirror in output schemas.
2. Optional `includeTotal` via clickhouse `withTotals()` (`query-builder.ts:902`), off by default.
3. React `useInfiniteDataset` / `useInfiniteQuery` deriving `getNextPageParam` from `meta.pagination.hasMore`.
4. Cursor/keyset pagination = separate follow-up (needs clickhouse builder support).

Files: `datasets/src/types.ts`, `datasets/src/executor.ts`, endpoint files, `react/src/createHooks.tsx`,
`analyticsHooks.tsx`.

## Phase 5 — Auth hardening

1. `createJwksStrategy` in `serve/src/auth.ts` (`jose`-backed, JWKS cache, RS256/ES256), tree-shakeable.
2. React: allow async `headers` (Promise) + `onUnauthorized`/`getToken` for refresh-and-retry-once.
3. Document a Redis `RateLimitStore`; note in-memory default is single-instance.

Files: `serve/src/auth.ts`, `react/src/createHooks.tsx`, docs/examples.

## Phase 6 — Caching & observability

1. Emit `Cache-Control` when `cacheTtlMs` is set; document POST = no CDN cache.
2. Add `includeMeta?: boolean` to input schema (keep `x-include-meta` header for back-compat); surface
   meta through React result.
3. Add `requestId` / `rowCount` to meta; correlate with `query-logger.ts` events.

Files: endpoint files, `serve/src/pipeline.ts`, `query-logger.ts`, React result plumbing.

---

## PR sequencing

| PR | Phase | Why |
|----|-------|-----|
| 1 | Phase 1 manifest | Unblocks correct client wiring; fixes most likely production breakage |
| 2 | Phase 2 schemas | Single source of truth for docs + validation; prerequisite for codegen |
| 3 | Phase 3 types | Builds on Phase 2 source; pure type work |
| 4 | Phase 4 pagination | Independent; high product value |
| 5 | Phase 5 auth | Independent; needed for SaaS GA |
| 6 | Phase 6 caching/obs | Polish |

## Cross-cutting risks

- `create-api.ts` / `metric-endpoint.ts` just moved to the `DatasetClient` abstraction
  (`createDatasetClient` / `analytics.execute`). Phases 2 & 4 touch these — land after refactor settles.
- `z.enum` empty-tuple and relationship-qualified field names are the Phase 2 correctness traps.
- Type-instantiation depth in Phase 3 over many datasets can stress `tsc` — keep helper types shallow.
