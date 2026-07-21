---
title: "How to Build an Internal Analytics Tool with ClickHouse and TypeScript"
description: "Ship an internal analytics tool on ClickHouse with three pieces: schema-generated types, a typed query builder, and a Next.js page. No BI platform, no governance layer — until you actually need one."
seoTitle: "Build an Internal Analytics Tool with ClickHouse and TypeScript"
seoDescription: "Build an internal analytics tool on ClickHouse with TypeScript: generated types, a typed query builder, and a Next.js page — no BI platform required."
pubDate: 2026-07-17
heroImage: ""
slug: internal-analytics-tool-clickhouse-typescript
status: published
tags:
  - ClickHouse
  - TypeScript
---

An internal analytics tool — the revenue page your ops team checks every morning, the usage dashboard product managers refresh before planning — does not need a BI platform. If your data is in ClickHouse and your team writes TypeScript, it is three pieces: types generated from your live schema, a typed query builder, and a Next.js page.

**Short answer:** run `npx hypequery generate` to turn your ClickHouse schema into TypeScript types, write queries with the typed builder from `@hypequery/clickhouse`, and render the results in a Next.js server component. No separate analytics service, no YAML model files, and — for a genuinely internal tool — no API governance layer. Add `@hypequery/react` hooks when the tool grows interactive panels, and `@hypequery/serve`'s validation and OpenAPI layer only when the tool stops being internal.

This post builds that stack end to end. If you are starting from zero, the [quick start](/docs/quick-start) covers installation and connection. If what you actually need is customer-facing dashboards, the [ClickHouse dashboard guide](/clickhouse-dashboard) covers that version of the problem — it has meaningfully different constraints.

## Internal tools are a different problem

Customer-facing analytics needs tenant isolation, input validation, rate limits, and a stable API contract, because the people hitting it are outside your trust boundary and outside your release cycle. An internal tool has neither problem. Everyone using it is behind your SSO, and when a chart breaks, the blast radius is a Slack message, not a support ticket.

What kills internal tools is not abuse. It is rot. The requirements change weekly, so the queries change weekly — and if those queries are SQL strings glued to untyped `fetch` calls, every schema change silently breaks a panel somewhere and nobody notices until the numbers look wrong in a planning meeting.

So the trade is different: skip the governance, keep the types. Governance is optional for an internal tool. Types are not.

## Step 1: Generate types from your live schema

```bash
npm install @hypequery/clickhouse
npx hypequery generate
```

The CLI connects to your ClickHouse instance, introspects the tables, and writes an `IntrospectedSchema` type. It encodes what ClickHouse actually returns over HTTP, not what the column types suggest: `UInt64` arrives as a JavaScript string, `DateTime` arrives as a formatted string, `Nullable(T)` becomes `T | null`. Those runtime realities are exactly the surprises that break hand-written types.

The examples below use a plain orders table:

```sql
CREATE TABLE orders (
  id String,
  customer_id String,
  status LowCardinality(String),
  total Float64,
  created_at DateTime
) ENGINE = MergeTree()
ORDER BY (created_at);
```

## Step 2: Write the queries with the typed builder

Connect once, in a server-only module:

```ts
// lib/db.ts
import { createQueryBuilder } from '@hypequery/clickhouse';
import type { IntrospectedSchema } from './generated/schema';

export const db = createQueryBuilder<IntrospectedSchema>({
  url: process.env.CLICKHOUSE_URL!,
  username: process.env.CLICKHOUSE_USERNAME!,
  password: process.env.CLICKHOUSE_PASSWORD,
  database: process.env.CLICKHOUSE_DATABASE!,
});
```

The two queries an internal revenue page always starts with — daily revenue and top customers. In SQL:

```sql
SELECT toStartOfDay(created_at) AS day,
       sum(total) AS revenue,
       count(id) AS order_count
FROM orders
WHERE created_at >= '2026-06-18 00:00:00'
GROUP BY day
ORDER BY day ASC
```

And the typed equivalents:

```ts
// lib/queries.ts
import { selectExpr } from '@hypequery/clickhouse';
import { db } from './db';

export function revenueByDay(from: string, to: string) {
  return db
    .table('orders')
    .select([selectExpr('toStartOfDay(created_at)', 'day')])
    .sum('total', 'revenue')
    .count('id', 'order_count')
    .where('created_at', 'gte', from)
    .where('created_at', 'lte', to)
    .groupByTimeInterval('created_at', '1 day', 'toStartOfDay')
    .orderBy('day', 'ASC')
    .execute();
}

export function topCustomers(from: string) {
  return db
    .table('orders')
    .select(['customer_id'])
    .sum('total', 'revenue')
    .count('id', 'order_count')
    .where('status', 'eq', 'completed')
    .where('created_at', 'gte', from)
    .groupBy('customer_id')
    .orderBy('revenue', 'DESC')
    .limit(10)
    .execute();
}
```

Column names, operators, and result shapes are all checked at compile time. Note the generated types will tell you that `order_count` comes back as a string — `count()` returns a `UInt64` — so you `Number()` it before charting instead of discovering the concatenation bug in production.

## Step 3: A page that is just a server component

For a read-only internal page, you do not need an API route at all. Server components run on the server, so they can call the builder directly:

```tsx
// app/analytics/page.tsx
import { revenueByDay, topCustomers } from '@/lib/queries';

export default async function AnalyticsPage() {
  const [daily, customers] = await Promise.all([
    revenueByDay('2026-06-18', '2026-07-18'),
    topCustomers('2026-06-18'),
  ]);

  const totalRevenue = daily.reduce((sum, row) => sum + Number(row.revenue), 0);

  return (
    <main>
      <h1>Revenue — last 30 days</h1>
      <p>{totalRevenue.toLocaleString()} total across {daily.length} days</p>
      <table>
        <tbody>
          {customers.map((row) => (
            <tr key={row.customer_id}>
              <td>{row.customer_id}</td>
              <td>{Number(row.revenue).toLocaleString()}</td>
              <td>{row.order_count}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </main>
  );
}
```

That is the whole tool. ClickHouse credentials never leave the server, there are no endpoints to secure beyond your existing app auth, and when someone drops a column next quarter, `npx hypequery generate` plus `tsc` lists every panel that breaks.

## Interactive filters: a route handler, still no framework

The first feature request is always a date picker. That means client-side fetching, which means an endpoint. A plain route handler that calls the same query function is enough:

```ts
// app/api/revenue/route.ts
import { revenueByDay } from '@/lib/queries';

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const from = searchParams.get('from') ?? '2026-01-01';
  const to = searchParams.get('to') ?? '2026-07-18';

  return Response.json(await revenueByDay(from, to));
}
```

Notice what is missing: input validation. For an internal tool behind SSO, that is an acceptable trade — the builder parameterizes values, so a malformed date produces a ClickHouse error, not an injection vector. If this route were customer-facing, you would want schema validation on every input. That is `@hypequery/serve`'s job, and we get to it below — the point is that you do not have to start there.

For the broader architecture questions — server components versus route handlers, where the connection lives, caching — see the [ClickHouse Next.js guide](/clickhouse-nextjs).

## When fetch glue accumulates: typed hooks

Two interactive panels in, every client component starts growing its own `fetch` call, its own loading state, and its own hand-written response type that drifts from the server. `@hypequery/react` gives you thin [TanStack Query](https://tanstack.com/query) hooks over the same endpoint, so the caching, deduplication, and refetch-on-focus come for free and you write the data fetch once:

```tsx
// components/RevenueChart.tsx
'use client';
import { useQuery } from '@tanstack/react-query';

export function RevenueChart({ from, to }: { from: string; to: string }) {
  const { data, isLoading, error } = useQuery({
    queryKey: ['revenue', from, to],
    queryFn: () =>
      fetch(`/api/revenue?from=${from}&to=${to}`).then((r) => r.json()),
  });

  if (isLoading) return <p>Loading…</p>;
  if (error) return <p>Failed to load revenue.</p>;

  return <LineChart data={data ?? []} xKey="day" yKey="revenue" />;
}
```

Because the query type still originates from the builder result in `lib/queries.ts`, you can share that inferred type with the component instead of re-typing the response by hand. Install `@hypequery/react @tanstack/react-query` and put a `QueryClientProvider` at your root — the [ClickHouse React hooks post](/blog/clickhouse-react-hooks) walks through the provider setup and parameterized queries in more detail.

Notice what you are still not doing: no zod schemas, no OpenAPI spec, no auth hooks on the query itself. The route handler is a bare passthrough because its only caller is your own page, behind your own SSO. That is the whole argument for skipping `@hypequery/serve` on an internal tool — the governance is genuine work with no internal payoff, right up until it has one.

## When to graduate to the full serve layer

Three signals, in the order they usually arrive:

1. **The tool leaks to customers.** Someone screenshots the dashboard in a sales call and asks whether customers can have it. The moment people outside your trust boundary get a login, tenant isolation, auth, and input validation stop being optional.
2. **Other teams start consuming the endpoints.** A second codebase hitting `/api/revenue` needs a stable, documented contract — which is what serve's OpenAPI generation is for.
3. **Non-TypeScript consumers show up.** BI tools, notebooks, or AI agents wanting the same numbers need a governed HTTP surface rather than imports.

When one of those hits, `@hypequery/serve` wraps the query functions you already have. The body barely changes — it moves inside a `query()` definition that adds a validated input schema and an auth-aware context:

```ts
// lib/api.ts
import { initServe } from '@hypequery/serve';
import { z } from 'zod';
import { db } from './db';

const { query, serve } = initServe({ context: () => ({ db }), basePath: '/api/analytics' });

const revenueByDay = query({
  description: 'Daily revenue for a date range',
  input: z.object({ from: z.string(), to: z.string() }),
  query: ({ ctx, input }) =>
    ctx.db
      .table('orders')
      .sum('total', 'revenue')
      .count('id', 'order_count')
      .where('created_at', 'gte', input.from)
      .where('created_at', 'lte', input.to)
      .groupByTimeInterval('created_at', '1 day', 'toStartOfDay')
      .execute(),
});

export const api = serve({ queries: { revenueByDay } });
```

The migration is additive, not a rewrite: your builder logic is intact, you have just gained input validation, OpenAPI docs, and auth hooks. That middle state — an internal tool quietly becoming an internal API — is common enough that we wrote it up separately in [internal product APIs](/use-cases/internal-product-apis).

## Where to go from here

- [Building dashboards on ClickHouse with hypequery and Next.js](/blog/building-dashboards-clickhouse-hypequery-nextjs) — a deeper dashboard walkthrough, including cross-filtering across panels
- [ClickHouse React hooks](/blog/clickhouse-react-hooks) — more on the typed hooks layer and parameterized queries
- [Internal product APIs](/use-cases/internal-product-apis) — for when your internal tool becomes something other teams depend on
