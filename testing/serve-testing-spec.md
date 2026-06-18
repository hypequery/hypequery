# @hypequery/serve — Manual Testing Spec

A self-contained test plan for `@hypequery/serve`, written so it can be handed to an
agent/model and executed end-to-end. It builds **two real, inspectable apps**:

- `hq-serve-test/` — a standalone runtime app (queries + metrics + datasets, auth, CORS, rate limiting, observability) you drive with `curl` and inspect at `/docs` and `/openapi.json`.
- `hq-serve-next/` — a Next.js app mounting the same `api` via the fetch adapter (optional but recommended).

- **Package under test:** `@hypequery/serve` (`v0.2.1`)
- **Companions:** `@hypequery/clickhouse`, `@hypequery/datasets`, `zod`
- **Docs covered:** `reference/api/runtime`, `re-using-queries`, `http-openapi`, `runtime-features`, `authentication`, `rate-limiting`, `observability`, `cors`, `fetch`, `embedded-runtime`, `nodejs`, `nextjs`, `vite`, `multi-tenancy`, `datasets/serve-integration`
- **Public API (verified against `src/index.ts` re-exports):**
  - `initServe`, `serve`, `query`, `createQueryFactory`, `createAPI`, `serveDev`
  - auth: `fromContext`, `createJwtStrategy`, `createApiKeyStrategy`, `createBearerTokenStrategy`, `createAnalyticsTokenIssuer`, `createAuthSystem`, `apiKeyAuth`, `AuthError`, `checkRoleAuthorization`, `checkScopeAuthorization`
  - rate limit: `rateLimit`, `MemoryRateLimitStore`, type `RateLimitStore`
  - adapters: `createFetchHandler`, `createNodeHandler`, `toFetchHandler`, `toNodeHandler`, `startServer`, `startNodeServer`
  - docs/client: `buildDocsHtml`, `extractClientConfig`, `defineClientConfig`, `getHeader`

> ⚠️ See **Appendix A** before running. One doc references a `hypequery serve` CLI command that does not exist.

---

## 0. Prerequisites & app skeleton

### 0.1 Tooling & connection
- Node ≥ 18, `tsx`, `curl`, `jq`.
- **Your real ClickHouse** — set `CLICKHOUSE_URL`, `CLICKHOUSE_DATABASE`, `CLICKHOUSE_USERNAME`, `CLICKHOUSE_PASSWORD`. **No seeding**; tests only read.
- This spec reuses the dataset built in **`datasets-testing-spec.md` §0.4–0.6**: introspect your schema, pick a fact-like table `T` with columns `Nᵢ` (numeric), `C` (low-cardinality string), `TS` (timestamp), `K` (a column used as tenant key), and build the `Target` dataset over it. Pick a real value `V` present in column `C` for filter examples, and two real values `K0`/`K1` from `K` for tenancy.
- `start` servers are long-running: launch backgrounded, poll, then SIGINT.

### 0.2 Create the app
```bash
mkdir hq-serve-test && cd hq-serve-test
npm init -y && npm pkg set type=module
npm install @hypequery/serve @hypequery/clickhouse @hypequery/datasets zod
npm install -D typescript tsx @types/node @hypequery/cli dotenv
npx tsc --init --module nodenext --moduleResolution nodenext --target es2022 --strict
# .env with your CLICKHOUSE_* connection details
```

### 0.3 Inspectable files
```
hq-serve-test/
  src/
    client.ts            # createQueryBuilder against YOUR ClickHouse
    datasets/target.ts    # TargetPublic (no tenantKey) + metrics — used by §1–§5, §8–§12
    datasets/target-tenant.ts # the tenant-keyed Target (tenantKey: 'K') — used by §6
    queries.ts           # initServe + query + serve  → exports `api`
    server.ts            # api.start({ port: 4000 })
    embedded.ts          # api.run / api.execute / api.client demos
    auth-app.ts          # a serve() variant with auth strategies
    introspect.ts        # writes api.describe() + api.manifest() + openapi.json to ./out/
  out/                   # generated descriptors + openapi (inspect these)
```

### 0.4 Datasets for the serve app

`src/datasets/target.ts` defines **`TargetPublic`** — the datasets spec's `Target`
(`src/datasets/target.ts`, §0.6 there) **but with no `tenantKey`** — so the general
semantic-endpoint tests (§4) don't each require tenant context. Export `TargetPublic` plus
the metrics `total` and `avgPerRow`.

`src/datasets/target-tenant.ts` re-exports the **tenant-keyed `Target`** (`tenantKey: 'K'`)
for §6 only.

> Because a tenant-keyed dataset is fail-closed, its endpoints reject calls without tenant
> identity. §6 configures `tenant: { extract, required: true }` so requests carrying a
> tenant succeed; §4 uses `TargetPublic` to keep the basic flows credential-free.

### 0.5 Base `src/queries.ts`
```typescript
import { initServe } from '@hypequery/serve';
import { z } from 'zod';
import { db } from './client.js';
import { TargetPublic, total, avgPerRow } from './datasets/target.js';

const { query, serve } = initServe({
  context: () => ({ db }),
  basePath: '/api/analytics',
});

// A hand-written query over your chosen table `T`. Replace col1/col2 with real columns,
// and adjust the output schema (or use z.array(z.record(z.unknown())) if you prefer).
export const recentRows = query({
  description: 'Recent rows from T',
  summary: 'List recent rows',
  tags: ['rows'],
  input: z.object({ limit: z.number().min(1).max(500).default(50) }),
  output: z.array(z.record(z.unknown())),
  query: ({ ctx, input }) =>
    ctx.db.table('T').select(['col1','col2']).orderBy('TS','DESC').limit(input.limit).execute(),
});

export const health = query({ requiresAuth: false, query: async () => ({ ok: true }) });

export const api = serve({
  queryBuilder: db,
  queries: { recentRows, health },
  metrics: { total, avgPerRow },
  datasets: { target: TargetPublic },
});

api.route('/recent-rows', api.queries.recentRows, { method: 'POST' });
```

---

## 1. `query({ ... })` — reusable definitions (`re-using-queries.mdx`)

### S1.1 — Local execution before HTTP
`await recentRows.execute({ input: { limit: 10 } })` returns up to 10 rows **without** starting a server. **Pass:** array result; respects `limit`.

### S1.2 — Input validation
`recentRows.execute({ input: { limit: 0 } })` → throws with zod issue (min 1). `{ limit: 999 }` → throws (max 500). Omitting `limit` → defaults to 50.

### S1.3 — Output validation
Temporarily tighten `output` to require a field the rows don't have (e.g. `z.array(z.object({ __missing: z.string() }))`) → execution throws an output-validation error. Restore after.

### S1.4 — Metadata fields
A `query({ description, summary, tags, requiredRoles, input, output })` definition carries all of those into `api.describe()` (see S3).

---

## 2. `serve(config)` + returned `api` (`reference/api/runtime.mdx`)

### S2.1 — Auto routes for queries
Start `api.start({ port: 4000 })`. Without any `api.route(...)`, every query is reachable at `POST /queries/<key>` under `basePath`. Verify:
```bash
curl -s -X POST http://localhost:4000/api/analytics/queries/health        # {"ok":true}
curl -s -X POST http://localhost:4000/api/analytics/queries/recentRows -H 'content-type: application/json' -d '{"limit":5}'
```

### S2.2 — Custom `api.route`
`/recent-rows` (registered in §0.5) responds to POST; GET to it → 404/405. Record.

### S2.3 — `api.run` / `api.execute` / `api.client` (aliases)
In `embedded.ts`: all three return identical results for `api.run('recentRows', { input: { limit: 3 } })`. Confirm `execute` and `client` are aliases.

### S2.4 — Semantic keys in `api.run`
`api.run('total', { input: { dimensions:['category'], limit:10 } })` and `api.run('dataset:target', { input: { dimensions:['category'], measures:['total','rows'] } })` both execute in-process. **Pass:** rows returned; dataset key is `dataset:target`.

### S2.5 — `api.start` options
`api.start({ port, hostname, quiet, requestTimeout, bodyLimit, gracefulShutdownTimeout })` returns a handle with `stop()`. Confirm `stop()` shuts the server (subsequent curl fails).

### S2.6 — `api.handler`
`typeof api.handler === 'function'`. Used by adapters (§7).

### S2.7 — `api.describe()`
Writes to `out/describe.json`. **Pass:** `.queries` lists `recentRows`, `health`, the metric `total`/`avgPerRow`, and `dataset:target`, each with method, path, auth requirements, contract metadata.

### S2.8 — `api.manifest()`
Writes `out/manifest.json`. **Pass:** keys map to `{ method, path }`, e.g. `total → { method:'POST', path:'/metrics/total' }`, `dataset:target → { method:'POST', path:'/datasets/target/query' }`. JSON-serializable.

### S2.9 — `api.use` / `api.useAuth`
`api.use(mw)` adds global middleware (see S8). `api.useAuth(strategy)` appends a strategy after creation (see S5).

---

## 3. HTTP + OpenAPI + docs (`http-openapi.mdx`)

### S3.1 — `/openapi.json`
`curl .../api/analytics/openapi.json | jq` → valid OpenAPI; includes paths for queries AND semantic endpoints (`/metrics/total`, `/datasets/target/query`). Save to `out/openapi.json`.

### S3.2 — OpenAPI customization
A `serve({ openapi: { title, version, servers } })` variant reflects the custom title/version/servers in the document.

### S3.3 — `/docs` UI
`curl .../api/analytics/docs` returns HTML referencing the openapi path. Open in a browser and confirm the page lists endpoints. `serve({ docs: { title, subtitle, darkMode: true } })` changes the rendered title/subtitle.

### S3.4 — `buildDocsHtml` helper
`buildDocsHtml('/openapi.json', { title, subtitle, darkMode: true })` returns an HTML string (self-host path). **Pass:** string contains the title and openapi URL.

---

## 4. Semantic metric/dataset endpoints (`datasets/serve-integration.mdx`)

### S4.1 — Generated endpoints
`POST /metrics/total` and `POST /datasets/target/query` exist (no `api.route` needed) and appear in OpenAPI/docs.

### S4.2 — Metric endpoint input
```bash
curl -X POST .../api/analytics/metrics/total -H 'content-type: application/json' \
  -d '{"dimensions":["category"],"filters":[{"field":"category","operator":"eq","value":"V"}],"orderBy":[{"field":"total","direction":"desc"}],"limit":10}'
```
**Pass:** `{ data: [...] }` rows; validated against the metric contract.

### S4.3 — Dataset endpoint input
`POST /datasets/target/query` with `dimensions`+`measures` returns `{ data }`.

### S4.4 — Validation
Unknown dimension / disallowed filter operator → 4xx with validation error body.

### S4.5 — `maxLimit` clamping (not rejection)
Register `metrics: { total: { metric: total, maxLimit: 5 } }`. Request `limit: 1000` → response clamps to 5 rows (not a 4xx). Confirm.

### S4.6 — `semanticPaths` override
`serve({ semanticPaths: { metrics: '/api/metrics', datasets: '/api/data' } })` → endpoints move to `POST /api/metrics/total` and `POST /api/data/target/query`.

### S4.7 — Pagination
`POST /datasets/target/query` with `{ limit:50, offset:50 }` → response reports served `offset` and `hasMore`.

### S4.8 — `includeMeta`
Body `includeMeta: true` OR header `x-include-meta: true` switches response to `{ data, meta }` with generated SQL, timing, rowCount, tenant, pagination.

### S4.9 — `queryBuilder` requirement
A `serve({ metrics })` with **no** `queryBuilder` and no `db` in context → construction/first-call error. Confirm the requirement; supplying via `context: () => ({ db })` also satisfies it.

### S4.10 — Per-entry options
`metrics: { total: { metric, requiredRoles, cache, maxLimit, middlewares } }` and `datasets: { target: { dataset, ... } }` register with those options (auth tested §5, cache observable via timing/`meta`, middleware §8).

---

## 5. Authentication (`authentication.mdx`)

Build `auth-app.ts` variants. Use `security: { verboseAuthErrors: true }` while testing so error bodies name missing roles/scopes.

### S5.1 — Auth implies protected-by-default
With any `auth` configured, a protected query without credentials → 401. `requiresAuth: false` (e.g. `health`) stays public. `query.public()` equivalently.

### S5.2 — `fromContext`
`auth: fromContext(({ request }) => readUser(request.raw))`. A request whose raw carries a user resolves `ctx.auth`; missing → null → 401 on protected routes. Confirm `request.raw` is the underlying Node/Fetch object.

### S5.3 — `createApiKeyStrategy`
`createApiKeyStrategy({ header: 'x-api-key', validate })`. Valid key → 200 + `ctx.auth`; missing/invalid → 401. Confirm header is read from `request.headers['x-api-key']` (plain object, not Fetch Headers).

### S5.4 — `createBearerTokenStrategy`
`Authorization: Bearer <token>` validated via `validate`. Valid → 200; invalid → 401.

### S5.5 — `createJwtStrategy` (HS256 secret)
Mint a token with the shared `secret` (matching `issuer`/`audience`), call a protected route → 200, claims mapped (`sub→userId`, `org_id→tenantId`, `roles→roles`, `scope/scopes→scopes`). Wrong secret/issuer/audience → 401. Test `mapClaims` override with non-standard claim names.

### S5.6 — `createAnalyticsTokenIssuer`
`const issue = createAnalyticsTokenIssuer({ secret, expiresIn:'15m', issuer, audience })`; mint a token, verify it against `createJwtStrategy({ secret })` → 200. An expired token (`expiresIn:'1ms'`, wait) → 401.

### S5.7 — `createAuthSystem` typed roles/scopes
`const { useAuth, TypedAuth } = createAuthSystem({ roles:['admin','editor'] as const, scopes:['read:data','write:data'] as const })`. Build `auth: useAuth(strategy)`. Confirm `requiredRoles`/`requiredScopes` typecheck against the declared sets (TS error on a typo — verify with `tsc --noEmit`).

### S5.8 — Per-query rules
- `requiredRoles: ['admin','editor']` → OR semantics: a user with **either** role passes; neither → 403.
- `requiredScopes: ['read:data','write:data']` → AND semantics: must have **both**; missing one → 403.
- declaring either implies auth (no anonymous access).
Confirm `verboseAuthErrors` toggles whether the 403 body names the missing role/scope.

### S5.9 — Guard methods (builder-compatible)
`query.use(...)`, `.requireAuth()`, `.requireRole(...)`, `.requireScope(...)`, `.public()` behave equivalently to the object-style fields.

### S5.10 — Auth on semantic endpoints
`datasets: { target: { dataset: Target, requiredRoles:['analytics'], requiredScopes:['read:data'] } }` → endpoint enforces the same OR/AND semantics. `auth: null` on an entry makes it public; an `auth` on the entry overrides the global strategy.

### S5.11 — Auth hooks
`onAuthFailure` / `onAuthorizationFailure` fire (see §9) with `event.queryKey` and `event.reason`/`event.required`.

---

## 6. Multi-tenancy (`multi-tenancy.mdx`)

For this section, build an `api` variant that registers the **tenant-keyed `Target`**
(`src/datasets/target-tenant.ts`, `tenantKey: 'K'`) and configures tenant extraction. Use
an auth strategy that resolves a tenant (e.g. `x-tenant` header → `auth.tenantId`).

### S6.1 — Tenant extraction + injection (builder queries)
`serve({ tenant: { extract: (auth) => auth.tenantId, required: true, column: 'K' } })`. A query with a tenant in auth auto-injects `K = <tenant>`; missing tenant when `required: true` → rejected.

### S6.2 — Semantic endpoints use dataset `tenantKey`
With the tenant-keyed `Target` (`tenantKey: 'K'`) registered, the metric/dataset endpoints pull tenant identity from auth (via serve `tenant.extract`) and inject the dataset's `tenantKey` predicate. Drive `POST /metrics/total` as tenant `K0` and `K1`; each response must equal the raw `SELECT sum(N1) ... WHERE K='K0'`/`'K1'` ground truth and be disjoint. A request with no tenant → rejected (fail-closed).

### S6.3 — Per-query `tenant` override
A `query({ tenant: ... })` overrides global tenant rules for that endpoint (e.g. a trusted job query). Confirm.

---

## 7. Delivery modes & adapters (`http-openapi`, `fetch`, `nodejs`)

### S7.1 — Standalone (`api.start`)
Covered in §2.5. `startServer`/`startNodeServer` exports also boot a server from `api.handler`. Smoke-test one.

### S7.1b — CLI dev server (`hypequery dev`)
The app's `src/queries.ts` exports `api`, so the CLI dev server runs it directly — this is the recommended **local** workflow (the production path is `api.start` / framework mount, §7.1/§7.3).
```bash
npx hypequery dev src/queries.ts --port 4000
# or, since src/queries.ts is an auto-detected entry, just:
npx hypequery dev --port 4000
```
**Expect:** `Found: src/queries.ts`, `Compiled queries`, `Connected to ClickHouse (… tables)`, `Registered N queries`, a box with `Docs`/`OpenAPI` URLs under `basePath`, `Watching for changes...`. Hit the same endpoints as §3–§4 (`/api/analytics/docs`, `/metrics/total`, `/datasets/target/query`). Edit `queries.ts` and confirm hot reload (`File changed, restarting...`). SIGINT → clean shutdown.
**Pass:** the CLI boots the identical runtime your `api.handler`/`api.start` serve, with docs + hot reload. (Full `dev` flag matrix — `--no-watch`, `--open`, `--path`, `-q`, error paths — lives in `cli-testing-spec.md` §4.)

### S7.2 — Fetch adapter
`const h = createFetchHandler(api.handler); await h(new Request('http://x/api/analytics/queries/health', { method:'POST' }))` → a `Response` with `{ ok: true }`. `toFetchHandler` equivalent.

### S7.3 — Node adapter (Express/Hono)
Mount `createNodeHandler(api.handler)` in an Express app at `/api/analytics`; or Hono `app.all('/api/analytics/*', c => createFetchHandler(api.handler)(c.req.raw))`. Confirm requests route through. `toNodeHandler` equivalent.

### S7.4 — Next.js (`hq-serve-next/`, optional)
Create `app/api/hypequery/[...hq]/route.ts` exporting `GET/POST/OPTIONS = createFetchHandler(api.handler)` with `runtime='nodejs'`. `npm run dev`, then `curl http://localhost:3000/api/hypequery/api/analytics/queries/health`. Inspect docs at the mounted path. **Pass:** same responses on the app's own port.

> Keep the mounted prefix aligned with `basePath` from `initServe`.

---

## 8. Runtime features (`runtime-features.mdx`)

### S8.1 — Global middleware `api.use`
Add a timing middleware that logs `durationMs`. Hit any endpoint → log appears, response unchanged. Confirm it also wraps semantic endpoints.

### S8.2 — Per-entry middleware
`metrics: { total: { metric, middlewares: [auditLog] } }` → `auditLog` runs only for `/metrics/total`, not other endpoints.

### S8.3 — `api.describe()` for tooling
Already in S2.7 — confirm semantic endpoints included with contract metadata.

---

## 9. Observability (`observability.mdx`)

### S9.1 — Lifecycle hooks
`serve({ hooks: { onRequestStart, onRequestEnd, onAuthFailure, onAuthorizationFailure, onError } })`. Drive: a success (start+end with `durationMs`), a 401 (`onAuthFailure`), a 403 (`onAuthorizationFailure` with `required`), and a thrown resolver (`onError`). Confirm `event.queryKey` is the metric name / `dataset:<name>` for semantic endpoints.

### S9.2 — Query logging
`queryLogging: 'json'` → structured logs per request. Also test `true` and a `(event) => void` callback.

### S9.3 — Slow query threshold
`slowQueryThreshold: 1` (ms) → a slow-query warning fires for normal requests. Record.

### S9.4 — Builder-level logging
`import { logger } from '@hypequery/clickhouse'; logger.configure({ enabled:true, level:'debug', onQueryLog })` → SQL-level logs with query/duration/status. Confirm distinct from runtime hooks.

---

## 10. Rate limiting (`rate-limiting.mdx`)

### S10.1 — Global
`middlewares: [rateLimit({ windowMs: 60_000, max: 3 })]`. 4th request within the window → `429` with rate-limit headers (when `headers` enabled) and the `message`. Confirm semantic endpoints are covered too.

### S10.2 — Per-query
`query.use(rateLimit({ windowMs:60_000, max:2 })).query(...)` limits only that query.

### S10.3 — `keyBy`
`rateLimit({ ..., keyBy: (ctx) => ctx.auth?.tenantId ?? null })`. Two tenants get independent counters; `keyBy` returning `null` → request skips limiting.

### S10.4 — Options
Exercise `store` (custom `RateLimitStore` — implement `increment`/`getTtl`/`reset`; also `MemoryRateLimitStore` default), `failOpen` (store throws → request proceeds vs fails), `message`, `headers` on/off.

### S10.5 — Per-entry on semantic endpoints
`datasets: { target: { dataset, middlewares: [rateLimit({ windowMs:60_000, max:30 })] } }` limits just that endpoint.

---

## 11. CORS (`cors.mdx`)

### S11.1 — `cors: true`
Preflight `OPTIONS` to an endpoint returns permissive `Access-Control-Allow-*` headers; actual request echoes them.

### S11.2 — Explicit config
`cors: { origin:['https://app.example.com','http://localhost:3000'], methods, allowedHeaders, exposedHeaders, credentials:true, maxAge:86400 }`. Confirm a disallowed origin is not reflected; allowed origin is; `Access-Control-Max-Age: 86400` present; applies to semantic endpoints too.

---

## 12. Embedded runtime (`embedded-runtime.mdx`)

### S12.1 — Background job pattern
`api.run('recentRows', { input:{ limit:10 }, context:{ jobId } })` runs with full validation/middleware/hooks, no HTTP. Confirm `context` is readable in middleware/resolver.

### S12.2 — Semantic embedded
`api.run('total', { input:{ dimensions:['category'], limit:10 } })` and `api.run('dataset:target', { input:{ dimensions:['category'], measures:['total','rows'] } })`.

### S12.3 — Errors throw
`api.run` with bad input throws containing validation issues (wrap in try/catch).

### S12.4 — Auth in embedded
Pass `options.request` so an auth strategy receives headers/tokens; without it, protected endpoints behave as unauthenticated.

### S12.5 — Direct dataset client alternative
`createDatasetClient(...).execute(target, query, context)` runs semantic queries without the serve runtime (cross-ref datasets spec §6).

---

## 13. Client config helpers (`reference/api/react.mdx` server side)

### S13.1 — `extractClientConfig(api)`
Returns a JSON-serializable config (method/path per route). Save to `out/client-config.json`. Used by the React spec's "config endpoint" pattern.

### S13.2 — `defineClientConfig`
Confirm it exists and produces/validates a client config object. Record shape.

---

## 14. Reporting template
Per scenario: request (curl/code), expected status + body shape, actual, PASS/FAIL, notes. Attach `out/openapi.json`, `out/describe.json`, `out/manifest.json`, `out/client-config.json` as inspectable artifacts. Confirm/deny Appendix A.

---

## Appendix A — Docs accuracy report

- **`npx hypequery serve` (FIXED).** `http-openapi.mdx` previously showed `npx hypequery serve src/analytics/queries.ts --port 8080` under "Production," but the CLI has no `serve` command (only `init`, `dev`, `generate`, `generate:types`, `generate:datasets`, `help`). The doc now points to `api.start({ port })` / mounting `api.handler` for production. Confirm the `serve` line is gone.
- **Auto-route path prefix:** `http-openapi.mdx` says every query is reachable at `POST /queries/<key>` automatically. Confirm the prefix (`/queries/...`) and how it composes with `basePath` (S2.1). Note actual path in the report.
- **`maxLimit` clamps, not rejects** (S4.5) — verify this holds for both metric and dataset endpoints, since it's an easy regression.
- **`queryBuilder` requirement timing:** docs say it's required when `metrics`/`datasets` are present, or supplied via `context`. Record whether a missing builder fails at `serve()` construction or at first request (S4.9).
