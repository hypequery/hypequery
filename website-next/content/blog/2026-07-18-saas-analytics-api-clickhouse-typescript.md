---
title: "How to Build a SaaS Analytics API with ClickHouse and TypeScript"
description: "A full-stack tutorial for building a SaaS analytics API: generate TypeScript types from your ClickHouse schema, write typed queries, define metrics once, serve zod-validated REST routes with OpenAPI docs, and consume them from React with inferred types."
seoTitle: "Build a SaaS Analytics API with ClickHouse and TypeScript"
seoDescription: "Build a SaaS analytics API on ClickHouse with TypeScript: generated schema types, a typed query builder, metrics defined once, zod-validated REST routes with OpenAPI docs, and React hooks that share the same type contract."
pubDate: 2026-07-18
heroImage: ""
slug: saas-analytics-api-clickhouse-typescript
status: published
tags:
  - ClickHouse
  - TypeScript
---

Every B2B SaaS product eventually grows an analytics surface: a usage page for customers, a revenue dashboard for the team, an endpoint the mobile app polls. The database is rarely the hard part — ClickHouse will aggregate a billion rows without complaint. The hard part is the stack above it: untyped SQL strings, hand-rolled Express routes, and a React component that guesses what shape the JSON has.

**Short answer:** put the data in ClickHouse and build the API as one typed TypeScript contract on top of it. With hypequery that is five short steps: `hypequery generate` introspects your ClickHouse schema into TypeScript types; the query builder writes tenant-scoped aggregations against those types; a dataset defines your metrics once; `@hypequery/serve` turns queries and metrics into zod-validated REST routes with an OpenAPI document; and `@hypequery/react` gives the frontend hooks whose types are inferred from those same route definitions. Rename a column in ClickHouse, regenerate, and the compiler points at every query, route, and component that needs to change — before anything ships.

This post is the end-to-end tour: each step is deliberately tight, with pointers to deeper material. If you want the architecture context first, the [ClickHouse SaaS analytics guide](/clickhouse-saas-analytics) covers why ClickHouse fits this workload; the [REST API](/clickhouse-rest-api) and [OpenAPI](/clickhouse-openapi) pages go deep on the serving layer, and the [React integration guide](/clickhouse-react) covers the frontend half. To follow along with your own database, start with the [quick start](/docs/quick-start).

## The working schema

One table, the classic shape for a multi-tenant SaaS:

```sql
CREATE TABLE orders (
  id String,
  tenant_id UInt32,
  region String,
  status String,
  total Float64,
  created_at DateTime
) ENGINE = MergeTree()
ORDER BY (tenant_id, created_at);
```

`tenant_id` first in the sort key, because almost every query this API serves will filter by tenant.

## Step 1: Generate types from the live schema

Install the packages and point the CLI at your database:

```bash
npm install @hypequery/clickhouse @hypequery/datasets @hypequery/serve @hypequery/react
npx @hypequery/cli generate
```

`hypequery generate` introspects the running ClickHouse instance and writes an `IntrospectedSchema` type. This is not a mirror of the DDL — it encodes what ClickHouse actually returns over HTTP: `UInt64` arrives as a **string** in JavaScript, `DateTime` arrives as a string, `Nullable(T)` becomes `T | null`. Those are the exact mismatches that produce `NaN` in a revenue chart at runtime, and the generated types surface them at compile time instead.

Wire the type into a client:

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

From here, `db` knows every table and column in your database.

## Step 2: Write a typed query

The first question any SaaS dashboard asks: daily completed revenue for one tenant. The SQL you want:

```sql
SELECT toStartOfInterval(created_at, INTERVAL 1 DAY) AS day, SUM(total) AS revenue
FROM orders
WHERE tenant_id = 42 AND status = 'completed'
GROUP BY toStartOfInterval(created_at, INTERVAL 1 DAY)
ORDER BY day ASC
```

The typed equivalent:

```ts
import { selectExpr } from '@hypequery/clickhouse';
import { db } from './client.js';

const dailyRevenue = await db
  .table('orders')
  .select([selectExpr('toStartOfInterval(created_at, INTERVAL 1 DAY)', 'day')])
  .groupByTimeInterval('created_at', '1 day')
  .sum('total', 'revenue')
  .where('tenant_id', 'eq', tenantId)
  .where('status', 'eq', 'completed')
  .orderBy('day', 'ASC')
  .execute();
```

Table names, column names, and comparison values are all checked against `IntrospectedSchema`. Misspell `created_at` or compare `tenant_id` to a string and the build fails. This is the layer you use for one-off, app-specific queries.

## Step 3: Define metrics once

A query answers one question. A SaaS analytics API answers the same questions repeatedly — revenue by day, by region, by status, filtered forty different ways — and every consumer must agree on what "revenue" means. That is a dataset:

```ts
// analytics/datasets/orders.ts
import { dataset, dimension, measure, eq, divide, nullIfZero } from '@hypequery/datasets';

export const Orders = dataset('orders', {
  source: 'orders',
  tenantKey: 'tenant_id',   // runtime tenant isolation on every query
  timeKey: 'created_at',    // enables day/week/month graining
  dimensions: {
    region: dimension.string(),
    status: dimension.string(),
    createdAt: dimension.timestamp({ column: 'created_at' }),
  },
  measures: {
    orderCount: measure.count('id'),
    revenue: measure.sum('total', { filters: [eq('status', 'completed')] }),
  },
});

export const revenue = Orders.metric('revenue', { measure: 'revenue' });
export const orderCount = Orders.metric('orderCount', { measure: 'orderCount' });

export const averageOrderValue = Orders.metric('averageOrderValue', {
  uses: { revenue, orderCount },
  formula: ({ revenue, orderCount }) => divide(revenue, nullIfZero(orderCount)),
});
```

Two things earn their keep here. `tenantKey` means every query through this dataset is scoped to a tenant at runtime — a request cannot forget the tenant filter, which is the bug that turns into a security incident. And the "completed only" rule lives inside the `revenue` measure itself, so no consumer can accidentally count refunded orders. The dataset also validates requests at runtime: an invalid dimension, filter, or limit is rejected before any SQL executes. The full model is covered in [Introducing hypequery Datasets](/blog/introducing-hypequery-datasets).

## Step 4: Serve it over HTTP with zod validation and OpenAPI

Now expose both layers — the custom query from step 2 and the metrics from step 3 — as governed routes:

```ts
// analytics/api.ts
import { initServe } from '@hypequery/serve';
import { selectExpr } from '@hypequery/clickhouse';
import { z } from 'zod';
import { db } from './client.js';
import { Orders, revenue, averageOrderValue } from './datasets/orders.js';

const { query, serve } = initServe({
  context: () => ({ db }),
  basePath: '/api/analytics',
});

const dailyRevenue = query({
  description: 'Daily completed revenue for a tenant',
  input: z.object({
    tenantId: z.number(),
    from: z.string(),
    to: z.string(),
  }),
  query: ({ ctx, input }) =>
    ctx.db
      .table('orders')
      .select([selectExpr('toStartOfInterval(created_at, INTERVAL 1 DAY)', 'day')])
      .groupByTimeInterval('created_at', '1 day')
      .sum('total', 'revenue')
      .where('tenant_id', 'eq', input.tenantId)
      .where('status', 'eq', 'completed')
      .where('created_at', 'between', [input.from, input.to])
      .orderBy('day', 'ASC')
      .execute(),
});

export const api = serve({
  queryBuilder: db,
  queries: { dailyRevenue },
  datasets: { orders: Orders },
  metrics: { revenue, averageOrderValue },
});
```

Mount it in whatever runtime you already have — for a Node server:

```ts
import express from 'express';
import { toNodeHandler } from '@hypequery/serve';
import { api } from './analytics/api.js';

const app = express();
app.use(toNodeHandler(api));
app.listen(3000);
```

Three things fall out of `serve()` without extra work:

- **Validated routes.** `GET /api/analytics/dailyRevenue` rejects a missing `tenantId` or a malformed date range with a structured error before your query code runs — that is the zod schema doing input validation at the boundary.
- **Metric routes.** `POST /api/analytics/metrics/revenue` accepts dimensions, filters, and time grains, all validated against what the `Orders` dataset actually allows.
- **An OpenAPI document.** `/api/analytics/openapi.json` describes every route and its input schema, with interactive docs at `/api/analytics/docs`. That document is generated from the same zod schemas and dataset definitions, so it cannot drift from the implementation.

The same definitions also run in-process — `api.execute('dailyRevenue', { input })` — so a cron job or an internal report uses the identical contract without an HTTP round trip. In production you would resolve `tenantId` server-side from the session via serve's auth hooks rather than trusting the client to send it; the mechanics are the same.

## Step 5: Consume the contract from React

The frontend imports only a *type* from the server — no server code in the bundle:

```ts
// web/src/analytics.ts
import { createHooks } from '@hypequery/react';
import type { InferAPIType } from '@hypequery/serve';
import type { api } from '../../analytics/api.js';

type Api = InferAPIType<typeof api>;

export const { useQuery } = createHooks<Api>({
  baseUrl: '/api/analytics',
});
```

```tsx
// web/src/RevenueChart.tsx
import { useQuery } from './analytics.js';

export function RevenueChart({ tenantId }: { tenantId: number }) {
  const { data, isLoading, error } = useQuery('dailyRevenue', {
    tenantId,
    from: '2026-06-01',
    to: '2026-07-01',
  });

  if (isLoading) return <Spinner />;
  if (error) return <ErrorState error={error} />;
  return <Chart data={data} />;
}
```

`useQuery` is a TanStack Query hook under the hood, so caching, deduplication, and refetching come for free. The important part is what the types know: `'dailyRevenue'` autocompletes from the API definition, the input object is checked against the zod schema's inferred type, and `data` has the row shape the query actually returns — including the runtime realities from step 1, like `day` being a string because ClickHouse serializes `DateTime` as a string.

Trace the whole chain: `orders.total` is `Float64` in ClickHouse → `IntrospectedSchema` types it → the builder checks `.sum('total', 'revenue')` against it → `serve()` publishes the inferred output type → `InferAPIType` carries it across the client boundary → `data` in `RevenueChart` is typed without a single hand-written interface. One contract, ClickHouse column to React prop. When the schema changes, `hypequery generate` plus `tsc` finds every break in that chain.

## Honest tradeoffs

Worth stating plainly before you commit:

- **hypequery is a library, not a platform.** You run it inside your own backend and own the deployment. If you want someone else to host the API layer and manage caching infrastructure, a managed service like Tinybird is a different and sometimes better trade.
- **The contract stops at TypeScript.** If Tableau or Metabase must consume the same metric definitions, a service-shaped semantic layer like Cube — with its own API gateway and JSON query format — fits that requirement better than in-process TypeScript definitions.
- **ClickHouse is the analytics store, not the system of record.** Keep transactional data in Postgres or MySQL; this stack is for the append-heavy, aggregation-first side of your product.

For a product team whose analytics surface is its own TypeScript frontend, though, the single-contract approach removes the exact class of bug that plagues hand-rolled analytics APIs: the backend and frontend silently disagreeing about the data.

## Where to go from here

- [ClickHouse multi-tenant analytics](/clickhouse-multi-tenant-analytics) — tenant isolation patterns in depth, including the `tenantKey` enforcement this post leaned on.
- [ClickHouse semantic layer](/clickhouse-semantic-layer) — the full dataset/metric model: relationships, derived metrics, and governance.
- [ClickHouse React integration](/clickhouse-react) — the frontend layer in more detail, including parameterized hooks and loading states.
