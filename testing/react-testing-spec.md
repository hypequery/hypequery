# @hypequery/react — Manual Testing Spec

A self-contained test plan for `@hypequery/react`, written so it can be handed to an
agent/model and executed end-to-end. It builds **one real, inspectable web app** under
`hq-react-test/` (Vite + React) that renders live query/metric/dataset results in the
browser, backed by a running `@hypequery/serve` API. An optional Next.js variant covers
the "share the server module" path.

- **Package under test:** `@hypequery/react` (`v0.1.1`)
- **Peers:** `react@^18`, `@tanstack/react-query@^5`; types from `@hypequery/serve`
- **Docs covered:** `react/getting-started`, `reference/api/react`, `react/using-queries`, `react/advanced-patterns`
- **Public API (verified against `src/index.ts`):** `createHooks`, `createAnalyticsHooks`, `queryOptions`, `HttpError`; types `CreateHooksConfig`, `CreateAnalyticsHooksConfig`, `QueryMethodConfig`, `QueryInput`, `QueryOutput`, `HttpMethod`.

> The hooks talk HTTP to a serve API. Stand up the backend from
> **`serve-testing-spec.md`** (`hq-serve-test/`, exporting `api` with `queries`,
> `metrics: { revenue, averageOrderValue }`, `datasets: { orders: Orders }`). Run it on
> `http://localhost:4000` with `basePath: '/api/analytics'` and **`cors: true`** (browser
> calls a different origin), or use the Vite proxy in §0.4.

---

## 0. Prerequisites & app skeleton

### 0.1 Backend
Start the serve app with the CLI dev server (recommended — gives hot reload + docs):
```bash
cd hq-serve-test && npx hypequery dev src/queries.ts --port 4000
```
(Equivalently `tsx src/server.ts`, which calls `api.start`.) Confirm
`curl -s -X POST http://localhost:4000/api/analytics/queries/health` → `{"ok":true}`.
Generate its route manifest for the client (see §1.3): the backend already writes
`out/manifest.json` (serve spec S2.8) — copy it, or fetch it via a config endpoint (§5).

### 0.2 Create the React app
```bash
npm create vite@latest hq-react-test -- --template react-ts
cd hq-react-test
npm install
npm install @hypequery/react @tanstack/react-query
npm install -D @hypequery/serve   # for InferApiType + manifest typing (type-only)
```

### 0.3 Inspectable files
```
hq-react-test/
  src/
    providers.tsx        # QueryClientProvider wrapper
    analytics.ts         # createHooks / createAnalyticsHooks (manifest wired)
    manifest.json        # copied from the serve app (api.manifest())
    components/
      ActiveUsers.tsx     # useQuery('activeUsers')
      RebuildButton.tsx   # useMutation(...)
      RevenueMetric.tsx   # useMetric('revenue')
      OrdersDataset.tsx   # useDataset('orders')
      InfiniteOrders.tsx  # useInfiniteDataset('orders')
    App.tsx              # renders all components
    typecheck.ts         # compile-only assertions for InferApiType
```

### 0.4 CORS / proxy
Either set `cors: true` on the serve API, **or** add a Vite proxy so the browser hits the same origin:
```ts
// vite.config.ts
server: { proxy: { '/api': 'http://localhost:4000' } }
```
With the proxy, `baseUrl: '/api'` and the serve `basePath` compose to `/api/analytics`. Pick one approach and note it.

### 0.5 Provider (`providers.tsx`)
```tsx
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
const queryClient = new QueryClient();
export const AppProviders = ({ children }: { children: React.ReactNode }) =>
  <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
```

---

## 1. Hook factories & setup (`getting-started.mdx`)

### R1.1 — `createHooks` with `InferApiType` (Option 1)
```ts
import { createHooks } from '@hypequery/react';
import type { InferApiType } from '@hypequery/serve';
import type { api } from '../../hq-serve-test/src/queries'; // type-only import
type Api = InferApiType<typeof api>;
export const { useQuery, useMutation } = createHooks<Api>({ baseUrl: '/api/analytics' });
```
**Pass:** `tsc --noEmit` succeeds; `useQuery`/`useMutation` exist.

### R1.2 — Manual type definition (Option 2)
A hand-written `type Api = { ... }` also produces working hooks. **Pass:** compiles, hooks usable.

### R1.3 — `createAnalyticsHooks` + manifest
```ts
export const { useQuery, useMutation, useMetric, useDataset, useInfiniteMetric, useInfiniteDataset } =
  createAnalyticsHooks<Api>({ baseUrl: '/api/analytics', manifest /* from manifest.json */ });
```
**Pass:** all six hooks returned.

### R1.4 — Missing manifest throws (not wrong URL)
Build analytics hooks **without** `manifest` and without a matching `config` entry; call `useMetric('revenue')`. **Pass:** it throws a clear error rather than requesting a wrong URL. (Docs guarantee.)

---

## 2. `useQuery` (`reference/api/react.mdx`)

### R2.1 — Basic query render
`ActiveUsers.tsx`: `const { data, error, isLoading } = useQuery('activeUsers', { limit: 5 })`. **Pass:** loading → rows render in the browser; `data` is typed to the query output.

### R2.2 — Typed input/key
TS: `useQuery('notARoute', ...)` is a type error; wrong input shape is a type error. Verify in `typecheck.ts`.

### R2.3 — TanStack options
Pass `{ staleTime, enabled: false, retry }` as the options arg; confirm `enabled:false` defers the request until toggled.

### R2.4 — Default GET vs method override
By default hooks issue GET. Since `activeUsers` is POST-only on the server (registered POST), wire `config: { activeUsers: { method: 'POST' } }` and confirm the request succeeds; without it, record the failure (GET to a POST route).

---

## 3. `useMutation`

### R3.1 — Mutation call
`RebuildButton.tsx`: `const m = useMutation('health'); m.mutate({})` (use any POST route; or add a `rebuildMetrics` query server-side). **Pass:** `m.isPending`→`m.isSuccess`, `m.data` typed.

### R3.2 — Error state
Trigger a validation error (bad input) → `m.error` is populated; structured JSON (status + body). `HttpError` is thrown/exposed for non-2xx.

---

## 4. Semantic hooks (`createAnalyticsHooks`)

### R4.1 — `useMetric`
`RevenueMetric.tsx`: `const { data } = useMetric('revenue', { dimensions:['country'], limit:10 })`. **Pass:** rows render; result is `{ data, meta }` so read rows from `result.data`.

### R4.2 — `useDataset`
`OrdersDataset.tsx`: `useDataset('orders', { dimensions:['country','status'], measures:['revenue','orderCount'] })` → maps to `POST /datasets/orders/query` via manifest. **Pass:** rows render.

### R4.3 — `useInfiniteMetric` / `useInfiniteDataset`
`InfiniteOrders.tsx`: `useInfiniteDataset('orders', { dimensions:['country'], measures:['revenue'], limit:2 })`. **Pass:** first page renders; `fetchNextPage()` advances using `meta.pagination` (requested via `x-include-meta`); `hasNextPage` reflects `hasMore`. Click "Load more" and confirm new rows append.

### R4.4 — `metrics` key narrowing
`createAnalyticsHooks<Api>({ ..., metrics: ['revenue','averageOrderValue'] as const })` — `useMetric('notAMetric')` becomes a type error. Verify in `typecheck.ts`.

### R4.5 — Wrong-route guard
With manifest present, `useDataset('ghost')` (unknown) → throws clear error, not a malformed request.

---

## 5. Config: headers, fetchFn, onUnauthorized, auto-config (`advanced-patterns.mdx`)

### R5.1 — Static `headers`
`createHooks({ ..., headers: { 'x-tenant-key': 't1' } })` → every request carries the header (verify in network tab / server log).

### R5.2 — Dynamic `headers` resolver
`headers: () => { const k = getTenantKey(); return k ? { 'x-tenant-key': k } : {}; }` — called per request; async resolver also supported. Confirm the header changes when the tenant changes.

### R5.3 — `fetchFn`
Provide a custom `fetchFn` that injects an `Authorization` header; confirm it's used for all requests.

### R5.4 — `onUnauthorized`
Point at a protected route returning 401; `onUnauthorized` fires, (e.g. refreshes a token), and the request **retries once**. Confirm single retry, then success/failure.

### R5.5 — `config` per-route overrides
`config: { weeklyRevenue: { method:'GET' }, rebuildMetrics: { method:'POST', path:'/custom' } }` overrides method/path per route.

### R5.6 — Auto-config Option A (share server module)
`createHooks<Api>({ baseUrl:'/api/hypequery', api })` — pass the `api` object directly; method metadata extracted automatically (reads `manifest()`). Works when the client can import the server bundle (Next.js variant §7). **Pass:** no manual `config`/`manifest` needed.

### R5.7 — Auto-config Option B (config endpoint)
Server: `app.get('/api/hypequery-config', () => Response.json(extractClientConfig(api)))` (serve spec S13.1). Client: fetch it once, then `createHooks<Api>({ baseUrl, config })`. **Pass:** hooks resolve methods from the fetched config; `getHypequeryHooks()` memoizes the promise.

---

## 6. `queryOptions` & error handling

### R6.1 — `queryOptions` export
Confirm `queryOptions` is exported and usable to build TanStack options objects (e.g. for `queryClient.prefetchQuery`). Record shape/usage.

### R6.2 — `HttpError`
A non-2xx response surfaces as `HttpError` with status + body through TanStack's `error` state. Network failure → standard `fetch` error. Validation errors arrive as structured JSON.

---

## 7. Next.js variant (`hq-react-next/`, optional but covers Option A)

### R7.1 — Mount + share module
Scaffold Next.js App Router. Add `app/api/hypequery/[...hq]/route.ts` mounting `createFetchHandler(api.handler)` (serve spec S7.4). In a client component, `createHooks<Api>({ baseUrl:'/api/hypequery/api/analytics', api })`. **Pass:** `useQuery`/`useMetric` render server-backed data on the app's own origin (no CORS).

---

## 8. End-to-end inspectable artifact
1. `npm run dev` (Vite) with the serve backend running. Open the app — **all components render live data**: active users list, revenue-by-country table, orders rollup, and an infinite orders list with a working "Load more".
2. Screenshot the running page (inspectable artifact).
3. `npx tsc --noEmit` passes, including the negative type assertions in `typecheck.ts` (commented `// @ts-expect-error` lines for R2.2, R4.4).
4. Note the chosen CORS/proxy approach and the `baseUrl` used.

**Pass:** every hook renders correct data in-browser; types infer end-to-end from the serve `api`; missing-manifest and unknown-route cases throw clear errors rather than hitting wrong URLs.

---

## 9. Reporting template
Per scenario: hook + args, baseUrl/method actually used (from network tab), expected vs actual render/state, PASS/FAIL, notes. Attach the screenshot and `tsc` output. Confirm/deny Appendix A.

---

## Appendix A — Things to confirm against docs
- **Default method is GET:** docs say hooks issue GET by default. Since serve auto-routes queries as POST (`/queries/<key>`) and semantic endpoints are POST, confirm whether plain `useQuery` needs a `config`/`manifest` method override for POST-only routes, or whether `api`/`manifest` auto-resolves the method (R2.4, R5.6). This is the most likely real-world snag — record exactly what's required.
- **Manifest requirement for semantic hooks:** confirm `useMetric`/`useDataset` throw without `manifest`/`config` (R1.4, R4.5) rather than calling a wrong URL.
- **Semantic response shape:** `useMetric`/`useDataset` return `{ data, meta }`; rows are under `.data`. Confirm the infinite hooks read `meta.pagination` and send `x-include-meta` automatically (R4.3).
- **`onUnauthorized` single retry:** confirm exactly one retry after the handler resolves (R5.4).
- **`baseUrl` composition:** document how `baseUrl` + serve `basePath` compose (e.g. `/api` proxy + `/api/analytics`), since a mismatch is a common 404 source.
