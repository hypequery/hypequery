# A ClickHouse REST API with OpenAPI docs, API keys and rate limits

Put a typed REST API in front of ClickHouse: named GET endpoints with validated params, API-key auth, rate limits, and an OpenAPI spec with live docs.

## Demo

```text
$ curl -s 'localhost:3000/api/metrics/daily-active-users?from=2026-10-01&to=2026-10-03' -H 'authorization: Bearer demo-key-change-me'
[{"day":"2026-10-01","activeUsers":1072},{"day":"2026-10-02","activeUsers":1074},{"day":"2026-10-03","activeUsers":769}]

$ curl -s 'localhost:3000/api/tenants/usage?tenantId=153' -H 'authorization: Bearer demo-key-change-me'
{"tenantId":153,"name":"Quartz Metrics","plan":"enterprise","events":17668,"activeUsers":176,"errors":427,"p95LatencyMs":684}

$ curl -s 'localhost:3000/api/metrics/top-paths?limit=500' -H 'authorization: Bearer demo-key-change-me'
{"error":{"type":"VALIDATION_ERROR","message":"Request validation failed","details":{"issues":[{"code":"too_big","maximum":50,"path":["limit"],...}]}}}

$ curl -s 'localhost:3000/api/tenants/usage?tenantId=153'
{"error":{"type":"UNAUTHORIZED","message":"Access denied","details":{"reason":"missing_credentials",...}}}
```

Open http://localhost:3000/docs for the generated API reference (Redoc): every endpoint, its parameters, their limits and the auth scheme. The raw spec is at http://localhost:3000/openapi.json.

## Install

```bash
npx hypequery create clickhouse-rest-api-openapi -y
cd clickhouse-rest-api-openapi
docker compose -f ../examples/_seed/docker-compose.yml up -d --wait && pnpm seed   # or set CLICKHOUSE_* for your own ClickHouse
pnpm install
pnpm dev
```

Set `API_KEY` before deploying; the default `demo-key-change-me` is for the demo only.

## What it shows

- **Named REST endpoints, not a SQL proxy** (`analytics/api.ts`): `GET /api/metrics/daily-active-users`, `GET /api/tenants/usage` and `GET /api/metrics/top-paths`, each a typed hypequery query registered with `api.route(path, query)`. Callers never send SQL.
- **Validated query-string input**: Zod schemas declare `from`, `to`, `tenantId` and `limit`. Query strings are coerced to numbers and dates first, then checked, so `?limit=500` is a 400 and never reaches ClickHouse.
- **OpenAPI and docs for free**: serve generates an OpenAPI 3.1 document from the same schemas at `/openapi.json`, with per-parameter types, defaults and limits, and a Redoc reference page at `/docs`. Load the spec into Postman, Insomnia or Swagger UI to try requests with your key.
- **API keys, rate limits and caching**: `createApiKeyStrategy` reads `Authorization: Bearer <key>` (401 without one), `rateLimit` allows 120 requests a minute per key per endpoint (429 with `retry-after` after that), and the query builder's `cache` serves repeat queries from memory for 30 seconds.
- **Checked by the smoke test** (`test/smoke.test.ts`): it boots on an ephemeral port, compares results with raw SQL, asserts the 400, 401 and 404 cases, and checks the spec lists every endpoint with its parameter schemas.

## Key file

`analytics/api.ts` (abridged; the full file has the third endpoint and the route table):

```ts
const { query, serve } = initServe({
  context: () => ({ db }),
  basePath: '', // /openapi.json and /docs at the root, endpoints under /api
  auth: createApiKeyStrategy({ validate: findApiKey }), // Authorization: Bearer <key>
  middlewares: [rateLimit({ windowMs: 60_000, max: 120, keyBy: (ctx) => ctx.auth?.userId ?? null })],
});

const range = {
  from: z.iso.date().default('2026-10-01').describe('First UTC day, inclusive (YYYY-MM-DD)'),
  to: z.iso.date().default('2026-10-31').describe('Last UTC day, inclusive (YYYY-MM-DD)'),
};

const dailyActiveUsers = query({
  summary: 'Daily active users',
  input: z.object(range),
  output: z.array(z.object({ day: z.string(), activeUsers: z.number() })),
  query: async ({ ctx, input }) => {
    const rows = await ctx.db.table('events')
      .select([toStartOfDay('occurred_at', 'day')])
      .countDistinct('user_id', 'activeUsers')
      .where('occurred_at', 'between', between(input))
      .groupBy('day')
      .orderBy('day', 'ASC')
      .execute();
    return rows.map((r) => ({ day: String(r.day).slice(0, 10), activeUsers: Number(r.activeUsers) }));
  },
});

export const api = serve({ queries: { dailyActiveUsers, tenantUsage, topPaths }, openapi: { ... }, docs: { ... } });

api
  .route('/api/metrics/daily-active-users', api.queries.dailyActiveUsers)
  .route('/api/tenants/usage', api.queries.tenantUsage)
  .route('/api/metrics/top-paths', api.queries.topPaths);
```

## Architecture

```text
client (curl, app, generated SDK)        Node + Hono (src/app.ts)                               ClickHouse
─────────────────────────────────        ────────────────────────────────────────────────       ──────────
GET /api/tenants/usage?tenantId=153 ──▶  createApiKeyStrategy ─▶ rateLimit ─▶ Zod input
  Authorization: Bearer <key>             └─ query builder (30 s cache) ─ SELECT ... FROM events ─▶
        ◀── typed JSON / 400 / 401 / 429
GET /openapi.json, /docs            ──▶  generated from the same Zod schemas (no key needed)
GET /healthz                        ──▶  your own Hono routes, side by side
```

## Adapt it

- **Generate a typed client from the spec.** `npx openapi-typescript http://localhost:3000/openapi.json -o api-types.ts` gives you path and parameter types for `openapi-fetch`; any OpenAPI generator (Python, Go, Java) works the same way. `hypequery generate:client` is the hypequery-native route for dataset and metric endpoints: it reads the client contract that `hypequery export:client-contract` writes, not this query-based spec.
- **Real API keys.** Replace `analytics/keys.ts` with a lookup by key hash in your database, and return `tenantId`, `roles` and `scopes` for the caller. Add `requiredScopes: ['read:metrics']` to a query to gate it.
- **Tenant-scoped keys.** Return `tenantId` from `validate` and add `tenant: { extract: (auth) => auth.tenantId, required: true }` to `serve(...)`, then read the tenant from `ctx` instead of the `tenantId` parameter.
- **Shared limits and cache.** Both stores are in memory, so each replica counts on its own. Pass a Redis-backed `RateLimitStore` to `rateLimit({ store })` and a shared `CacheProvider` to `createQueryBuilder({ cache })` when you run more than one instance.
- **Path parameters.** serve's router matches exact paths, so the tenant is a query parameter. For `/api/tenants/:id/usage`, add a Hono route that reads `c.req.param('id')` and calls `api.queries.tenantUsage` yourself; the OpenAPI document will not describe that route.
- **Express instead of Hono.** `app.all('/{*path}', createNodeHandler(api.handler))` mounts the same API; register it before `express.json()`.

The spec also lists each query at its default `/queries/<name>` path, which stays live beside the `/api/...` routes. Point clients at the `/api/...` paths.

## Related recipes

- [p95-latency](../../recipes/p95-latency): the p95 latency number in `/api/tenants/usage`, explained.

## Related examples

- [multi-tenant-embedded-analytics](../multi-tenant-embedded-analytics): the same serve runtime with signed per-tenant tokens and a semantic dataset.
- [fastapi-analytics-api](../fastapi-analytics-api): the Python version, an analytics API on FastAPI.

Tested on ClickHouse 25.8 with `@hypequery/serve` 0.24 and 0.25, `@hypequery/clickhouse` 2.14 and 2.15, and Hono 4.
