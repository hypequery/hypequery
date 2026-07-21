---
title: "How to Expose ClickHouse Queries as a Typed REST API"
description: "A step-by-step primer on turning a ClickHouse query into a governed, typed REST API with @hypequery/serve — context, zod input validation, OpenAPI docs, auth hooks, and one query definition callable in-process or over HTTP."
seoTitle: "ClickHouse REST API: Expose Typed Queries Over HTTP in TypeScript"
seoDescription: "Build a ClickHouse REST API in TypeScript. Define a query once with zod-validated input, serve it over HTTP with generated OpenAPI docs, attach auth, and call it in-process — step by step with @hypequery/serve."
pubDate: 2026-07-18
heroImage: ""
slug: typed-rest-api-clickhouse
status: published
tags:
  - ClickHouse
  - TypeScript
---

ClickHouse ships an HTTP interface on port 8123, but you should almost never expose it to clients directly: it accepts arbitrary SQL, returns raw wire formats, and knows nothing about your app's auth. What you actually want between ClickHouse and your frontend is a thin API layer that validates input, runs a query you wrote, and returns JSON.

**Short answer:** define each query once with `@hypequery/serve` — a zod input schema plus a typed query-builder call — then hand the collection to `serve()`. Every query becomes an HTTP route with input validation, the API publishes OpenAPI docs, auth hooks attach upstream of your query logic, and the same definition is callable in-process via `api.execute(...)`. No duplicate handler code, no untyped request bodies.

This post is a focused primer on that API layer and nothing else — no dashboard, no full semantic layer, no frontend build. If you want the whole toolchain tour from schema generation to React hooks, read the [SaaS analytics API tutorial](/blog/saas-analytics-api-clickhouse-typescript). Here we go step by step through `initServe`: context, `basePath`, `query()` with zod, `serve()`, mounting the routes on your server, the OpenAPI output, and where auth attaches. If you have not connected to ClickHouse yet, start with the [quick start](/docs/quick-start).

## Step 0: A Typed ClickHouse Client

The API layer builds on the hypequery query builder, so set that up first. Schema generation introspects your live ClickHouse and writes TypeScript types from your real tables:

```bash
npm install @hypequery/clickhouse @hypequery/serve zod
npx hypequery generate
```

```ts
// analytics/client.ts
import { createQueryBuilder } from '@hypequery/clickhouse';
import type { IntrospectedSchema } from './generated/schema.js';

export const db = createQueryBuilder<IntrospectedSchema>({
  url: process.env.CLICKHOUSE_URL!,
  username: process.env.CLICKHOUSE_USERNAME!,
  password: process.env.CLICKHOUSE_PASSWORD,
  database: process.env.CLICKHOUSE_DATABASE!,
});
```

The examples below assume an `orders` table with `id`, `user_id`, `region`, `status`, `total`, and `created_at` columns. Because `db` carries your generated schema types, a query against it is fully typed — column names, filter operators, and result shape all come from your real ClickHouse schema. The job of `serve` is to expose that query over HTTP without losing any of that safety.

## Step 1: initServe — Context and basePath

Everything starts with `initServe`. You call it once, and it hands back two functions: a `query` function to define endpoints and a `serve` function to bundle them into an API.

```ts
// analytics/serve.ts
import { initServe } from '@hypequery/serve';
import { db } from './client.js';

export const { query, serve } = initServe({
  context: () => ({ db }),
  basePath: '/api/analytics',
});
```

Two configuration options matter here:

- **`context`** is a factory that runs per request and returns whatever your queries need — most importantly your `db` client. Every query you define receives this object as `ctx`. Because it is a function, you can build per-request context later (for example, deriving a tenant ID from the incoming request) without touching any query definition. The important discipline: queries never import `db` directly, they receive it through `ctx`. That makes them trivially testable — pass a fake context — and keeps request-scoped values from leaking into module scope.
- **`basePath`** is the URL prefix every route is mounted under. With `/api/analytics`, all your analytics endpoints live below that prefix, grouped and out of the way of the rest of your app.

## Step 2: Define a Query with a zod Input

`query()` pairs an input schema with a query-builder call. Each definition takes a `description`, an `input` schema written with [zod](https://zod.dev), and a `query` function that receives `{ ctx, input }` and returns the result.

```ts
// analytics/queries.ts
import { z } from 'zod';
import { selectExpr } from '@hypequery/clickhouse';
import { query } from './serve.js';

export const revenueByDay = query({
  description: 'Daily completed-order revenue for the last N days',
  input: z.object({
    days: z.coerce.number().int().min(1).max(90),
    region: z.string().optional(),
  }),
  query: ({ ctx, input }) => {
    const since = new Date(Date.now() - input.days * 86_400_000)
      .toISOString()
      .slice(0, 19)
      .replace('T', ' ');

    let q = ctx.db
      .table('orders')
      .select([selectExpr('toStartOfDay(created_at)', 'day')])
      .sum('total', 'revenue')
      .count('id', 'order_count')
      .where('status', 'eq', 'completed')
      .where('created_at', 'gte', since)
      .groupByTimeInterval('created_at', '1 day', 'toStartOfDay')
      .orderBy('day', 'ASC');

    if (input.region) {
      q = q.where('region', 'eq', input.region);
    }

    return q.execute();
  },
});
```

The zod schema is the contract, and it does three jobs at once:

1. **Runtime validation.** A request with `days=400`, or a missing `days`, or `days=7;DROP TABLE orders` is rejected before the query function runs. Nothing unvalidated reaches ClickHouse. The `z.coerce.number()` turns a string like `"7"` into a number before the range check, which is handy since query-string values arrive as strings.
2. **Static types.** Inside the `query` function, `input` is inferred as `{ days: number; region?: string }` straight from the zod schema. Misspell `input.regoin` and it fails to compile.
3. **API documentation.** The same schema feeds the generated OpenAPI spec (next section), so your validation rules and your docs can never drift apart.

The query body is ordinary typed builder code, so the whole chain stays safe end to end: `input.days` is a validated `number`, `.where('status', 'eq', 'completed')` is checked against your schema, and the result type flows through to the HTTP response. One runtime detail worth internalizing: `count()` produces a ClickHouse `UInt64`, which arrives in JavaScript as a **string** (it can exceed `Number.MAX_SAFE_INTEGER`), and `DateTime` comes back as a string too. hypequery's generated types encode that honestly.

## Step 3: serve() — Bundle Queries into an API

`serve()` assembles your query definitions into an API object.

```ts
// analytics/api.ts
import { serve } from './serve.js';
import { revenueByDay } from './queries.js';

export const api = serve({
  queries: { revenueByDay },
});
```

That is the whole route definition. Each key in `queries` becomes a callable endpoint under your `basePath` — add a definition, get a route, no extra wiring. `serve()` also accepts `metrics` and `datasets`, so once you adopt the [semantic layer](/clickhouse-semantic-layer) you can expose governed metrics and datasets from the same call:

```ts
// serve({ queries: { revenueByDay }, metrics: { revenue }, datasets: { orders: Orders } })
```

For a first API layer, a `queries` map is all you need.

## Step 4: Mount the Routes on Your Server

The `api` object carries a transport-agnostic handler. To mount it on an existing Node framework, wrap it with `toNodeHandler`, which turns the API into standard `(req, res)` middleware. With Express:

```ts
// server.ts
import express from 'express';
import { toNodeHandler } from '@hypequery/serve';
import { api } from './analytics/api.js';

const app = express();
app.use(express.json());
app.use(toNodeHandler(api));

app.listen(3000);
```

That is it. Your `revenueByDay` query is now a real HTTP endpoint at `/api/analytics/queries/revenueByDay`, validating input with zod and returning typed ClickHouse results as JSON. The handler is framework-agnostic: `toNodeHandler(api)` mounts it on [Express](/clickhouse-express), and `toFetchHandler(api)` gives you a Fetch-API handler for [Hono](/clickhouse-hono), Bun, or edge runtimes. If you want a standalone server with no framework at all, `startServer(api, { port: 3000 })` boots one directly. Either way the analytics layer does not care which router you standardized on, and these routes live alongside your existing endpoints in the same deploy.

## What the OpenAPI Output Gives You

Because every query declares a zod `input` schema and a `description`, `serve` can emit a full [OpenAPI](/clickhouse-openapi) document describing your API: each route, its method, its input shape (including constraints like `min` and `max`), and its docstring. You do not write or maintain this by hand — it is derived from the same definitions that power validation and typing.

That gets you a few things for free:

- **A live contract.** Frontend and backend agree on the exact request shape, because both read from one generated spec.
- **Client generation.** Point any OpenAPI codegen tool at the document to generate typed clients in other languages.
- **Interactive docs.** Serve the spec through Swagger UI or similar so consumers can explore and try endpoints from the browser.

The property that makes this worth it: the docs cannot lie. Add a field to a zod schema and the OpenAPI output reflects it immediately — there is no second source of truth to keep in sync, no stale spec describing a parameter that was renamed two quarters ago. This is the difference between a documented [ClickHouse REST API](/clickhouse-rest-api) and a pile of undocumented handlers.

## The Same Query, In-Process or Over HTTP

This is the payoff over hand-writing handlers: a query defined with `serve` is callable two ways from one definition.

**Over HTTP**, a client hits the route:

```bash
curl 'http://localhost:3000/api/analytics/queries/revenueByDay?days=7&region=eu-west'
```

```json
[
  { "day": "2026-07-12 00:00:00", "revenue": 48210.5, "order_count": "1823" },
  { "day": "2026-07-13 00:00:00", "revenue": 51877.25, "order_count": "1904" }
]
```

**In-process**, your own server-side code calls `api.execute` directly — no network round trip, but the same validation and the same typed result:

```ts
// In a cron job, a test, or another server module:
const rows = await api.execute('revenueByDay', {
  input: { days: 7 },
});
```

This matters more than it looks. A scheduled weekly-report job, a server-rendered page, or another internal service can reuse the exact query the HTTP API exposes — same validation, same result type, zero duplication. The route and the function are the same thing, so they cannot drift apart. This ends the "same query, three implementations" problem — one in a script, one in an Express handler, one in a notebook, each subtly different.

On the frontend, `@hypequery/react` consumes these same endpoints as typed TanStack Query hooks, so the types you defined here flow all the way to your React components. One definition; server callers, HTTP consumers, and React all share it.

## Where Auth Attaches

A public analytics endpoint is rarely acceptable — you need authentication and, for multi-tenant apps, isolation so tenant A can never read tenant B's rows. In `serve`, auth attaches at two natural points, both upstream of your query logic.

**At the router.** Because `toNodeHandler(api)` returns standard middleware-style handlers, your framework's existing auth middleware runs first. Reject unauthenticated requests before they ever reach a query:

```ts
app.use('/api/analytics', requireAuth); // your existing middleware
app.use(toNodeHandler(api));
```

**In `context`.** This is the important one for multi-tenant analytics. The `context` factory runs per request and receives `{ request, auth }`, so it is where you derive trusted, server-side values — the authenticated user or tenant ID — and hand them to your queries as `ctx`. The `auth` object is populated by an auth strategy you register with `useAuth`:

```ts
export const { query, serve } = initServe({
  context: ({ auth }) => ({
    db,
    tenantId: auth?.tenantId, // from the verified session, never from input
  }),
  basePath: '/api/analytics',
});

const tenantOrders = query({
  description: 'Recent orders for the current tenant',
  input: z.object({
    status: z.enum(['pending', 'completed', 'cancelled']),
  }),
  query: ({ ctx, input }) =>
    ctx.db
      .table('orders')
      .where('tenant_id', 'eq', ctx.tenantId) // from context, not input
      .where('status', 'eq', input.status)
      .orderBy('created_at', 'DESC')
      .limit(50)
      .execute(),
});
```

The rule to internalize: anything the caller may choose goes in `input` and through zod validation; anything the caller must not choose — user ID, tenant ID, role — comes from `context`, resolved server-side from the session. A client can ask for `status: 'completed'`, but it can never ask for another tenant's `tenant_id`, because that value is never read from the request body. A caller cannot widen their own scope by editing a request.

## When You Don't Need This

Honest scoping: if you have one internal endpoint and no second consumer, a plain Express handler calling the query builder directly is fine, and adding a serve layer is ceremony. The layer pays for itself when multiple consumers (dashboard + cron + CLI) need the same queries, external callers need docs they can trust, or input validation is turning into copy-pasted boilerplate across handlers. If you are already invested in tRPC or GraphQL for your whole API surface, keeping analytics in that stack is also reasonable — the query builder works the same inside any resolver. The trade-offs between those approaches live in the [ClickHouse API guide](/clickhouse-api).

## Where to Go From Here

- [ClickHouse API design approaches](/clickhouse-api) — REST vs GraphQL vs tRPC for analytics endpoints, and when each fits.
- [Serving a ClickHouse REST API](/clickhouse-rest-api) — the pillar page on exposing governed HTTP routes.
- [ClickHouse OpenAPI guide](/clickhouse-openapi) — customizing the generated spec and generating typed clients from it.
- [SaaS analytics API tutorial](/blog/saas-analytics-api-clickhouse-typescript) — the full-stack version: schema, semantic layer, serve, and frontend in one build.
