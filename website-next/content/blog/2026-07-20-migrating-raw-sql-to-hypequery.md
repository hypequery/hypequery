---
title: "Migrating from Raw SQL Strings to hypequery"
description: "A step-by-step migration guide from @clickhouse/client SQL strings and hand-written row interfaces to generated types and a typed builder — incrementally, hot paths first, with honest escape hatches for the SQL you keep."
seoTitle: "Migrate Raw SQL to Type-Safe TypeScript: A ClickHouse Guide"
seoDescription: "How to migrate raw SQL strings and hand-written row interfaces to typed TypeScript queries against ClickHouse — an incremental strategy with before/after code, CI drift checks, and escape hatches."
pubDate: 2026-07-20
heroImage: ""
slug: migrating-raw-sql-to-hypequery
status: published
tags:
  - ClickHouse
  - TypeScript
---

**Short answer:** you don't rewrite everything. Install `@hypequery/clickhouse` next to your existing `@clickhouse/client` code, run `npx hypequery generate` to produce TypeScript types from your live ClickHouse schema, migrate the queries that change most often, and leave your gnarliest analytical SQL exactly where it is. hypequery builds on the official client, so the two coexist in the same process against the same connection details. The migration is incremental by design, and the escape hatches (`selectExpr`, `.withCTE()` with raw SQL strings) mean you never hit a wall where the builder forces a rewrite.

The reason to migrate at all is a specific failure mode: hand-written row interfaces drift from the actual schema, TypeScript never notices, and the bug surfaces as `NaN` on a dashboard instead of a compile error. This post shows that failure concretely, then the before/after diff, then the strategy.

If you want to see the generated-types workflow end to end first, the [quick start](/docs/quick-start) covers it in a few minutes, and the [ClickHouse TypeScript guide](/clickhouse-typescript) covers the broader landscape.

## The setup everyone starts with

This is a perfectly normal analytics module built on the official client. Most ClickHouse + TypeScript codebases look like this:

```ts
// analytics/orders.ts — the "before"
import { createClient } from '@clickhouse/client';

const client = createClient({
  url: process.env.CLICKHOUSE_URL,
  username: process.env.CLICKHOUSE_USERNAME,
  password: process.env.CLICKHOUSE_PASSWORD,
  database: process.env.CLICKHOUSE_DATABASE,
});

// Hand-written. Nothing checks this against the actual table.
interface OrderRow {
  id: string;
  tenant_id: number;
  total: number;
  status: string;
  created_at: string;
}

export async function revenueByDay(tenantId: number) {
  const result = await client.query({
    query: `
      SELECT toStartOfDay(created_at) AS day, sum(total) AS revenue
      FROM orders
      WHERE tenant_id = {tenantId:UInt32} AND status = 'completed'
      GROUP BY day
      ORDER BY day ASC
    `,
    query_params: { tenantId },
    format: 'JSONEachRow',
  });
  return result.json<{ day: string; revenue: number }>();
}

export async function recentOrders(tenantId: number) {
  const result = await client.query({
    query: `
      SELECT * FROM orders
      WHERE tenant_id = {tenantId:UInt32}
      ORDER BY created_at DESC
      LIMIT 50
    `,
    query_params: { tenantId },
    format: 'JSONEachRow',
  });
  return result.json<OrderRow>();
}
```

There is nothing wrong with this code today. The problem is what happens to it in six months.

## How it fails: the rename nobody finishes

Someone renames a column as part of a schema cleanup:

```sql
ALTER TABLE orders RENAME COLUMN total TO total_amount;
```

Two things happen, and only one of them is loud.

`revenueByDay` fails loudly. `sum(total)` now throws `Unknown identifier: total` at runtime. Someone sees the error in staging, greps for `total`, fixes the SQL string to `sum(total_amount)`. Fine.

`recentOrders` fails silently. It uses `SELECT *`, so the query still succeeds — the rows just come back with `total_amount` instead of `total`. The `OrderRow` interface still declares `total: number`, and `result.json<OrderRow>()` is a **type assertion, not validation**. TypeScript trusts whatever you tell it. So this dashboard code compiles cleanly:

```ts
const orders = await recentOrders(42);
const gross = orders.reduce((sum, o) => sum + o.total, 0);
// o.total is undefined at runtime → gross is NaN
```

The dashboard renders `NaN`. No exception, no failed request, no alert. The bug ships and sits there until a customer asks why their revenue tile is blank.

And that's the *clean* version of the failure. Hand-written interfaces are usually wrong in quieter ways from day one: `UInt64` columns come back from ClickHouse's JSON formats as **strings**, not numbers (so `sum + o.total` concatenates instead of adding), `DateTime` comes back as a string, and `Nullable(T)` should be `T | null`. An interface someone typed from memory encodes hopes, not the schema.

## The after: generated types + typed builder

The fix is to make the schema the source of truth. Install hypequery alongside the existing client and introspect your live database:

```bash
npm install @hypequery/clickhouse
npx hypequery generate
```

`generate` connects to ClickHouse, reads the real schema, and writes a types file — including the runtime realities above (`UInt64` → `string`, `Nullable(T)` → `T | null`). You never edit it by hand; you rerun `generate` when the schema changes.

The same two queries, rewritten:

```ts
// analytics/orders.ts — the "after"
import { createQueryBuilder } from '@hypequery/clickhouse';
import type { IntrospectedSchema } from './generated/schema.js';

const db = createQueryBuilder<IntrospectedSchema>({
  url: process.env.CLICKHOUSE_URL!,
  username: process.env.CLICKHOUSE_USERNAME!,
  password: process.env.CLICKHOUSE_PASSWORD,
  database: process.env.CLICKHOUSE_DATABASE!,
});

export function revenueByDay(tenantId: number) {
  return db
    .table('orders')
    .sum('total_amount', 'revenue')
    .where('tenant_id', 'eq', tenantId)
    .where('status', 'eq', 'completed')
    .groupByTimeInterval('created_at', '1 day', 'toStartOfDay')
    .execute();
}

export function recentOrders(tenantId: number) {
  return db
    .table('orders')
    .select(['id', 'total_amount', 'status', 'created_at'])
    .where('tenant_id', 'eq', tenantId)
    .orderBy('created_at', 'DESC')
    .limit(50)
    .execute();
}
```

No hand-written interface, no `SELECT *`, no assertion. Now replay the rename: run `npx hypequery generate`, and `total` disappears from the generated types. Every `.select(['total', ...])`, `.sum('total', ...)`, and `o.total` in the codebase becomes a **compile error**. `tsc` hands you the complete list of stale call sites. The bug that used to ship as `NaN` now can't build.

The [5-minute walkthrough](/blog/turn-your-clickhouse-schema-into-a-type-safe-analytics-layer-in-5-minutes) shows this generate → query → regenerate loop on a fresh project if you want to try it before touching production code.

## The migration strategy: incremental, hot paths first

This is the part that matters more than the syntax. A big-bang rewrite of every query is how migrations stall. Do it in this order instead.

### 1. Install alongside, don't replace

hypequery is built on `@clickhouse/client`, so nothing about your existing setup has to move. Point `createQueryBuilder` at the same URL and database, commit the generated schema file, and ship that with zero queries migrated. You now have typed schema information in the repo even for code that still uses raw strings — the [hypequery vs @clickhouse/client comparison](/compare/hypequery-vs-clickhouse-client) covers how the two layers relate in more detail.

### 2. Migrate hot-path queries first

Rank your queries by how often they *change*, not how often they run. A query edited monthly by three different people is where drift happens; a query nobody has touched since 2024 is not. In practice the hot paths are product-facing dashboard queries, anything parameterized by tenant, and anything a junior engineer will extend next sprint. Migrate those first — they're also usually the simple ones (filter, aggregate, group, order), which the builder covers completely.

### 3. Keep the gnarly SQL raw — use the escape hatches

Some queries should stay as SQL. A 200-line funnel analysis with window functions and nested CTEs that has been tuned by hand is not a migration target; it's a liability to rewrite. hypequery's position on this is explicit: the builder doesn't pretend to model every ClickHouse feature (window functions and `SAMPLE` aren't first-class methods, ASOF JOIN isn't a builder method), and the escape hatches are the supported path, not a workaround.

`selectExpr` embeds a raw SQL expression inside an otherwise typed query:

```ts
import { selectExpr } from '@hypequery/clickhouse';

const ranked = await db
  .table('orders')
  .select([
    'tenant_id',
    'id',
    'total_amount',
    selectExpr(
      'ROW_NUMBER() OVER (PARTITION BY tenant_id ORDER BY total_amount DESC)',
      'rank'
    ),
  ])
  .where('status', 'eq', 'completed')
  .execute();
```

`.withCTE()` accepts a plain SQL string, so a hand-tuned subquery can live inside a typed outer query:

```ts
const withFirstOrder = await db
  .table('orders')
  .withCTE(
    'first_orders',
    `SELECT tenant_id, min(created_at) AS first_order_at
     FROM orders
     GROUP BY tenant_id`
  )
  .innerJoin('first_orders', 'tenant_id', 'first_orders.tenant_id')
  .select(['id', 'created_at', 'first_orders.first_order_at as first_order_at'])
  .execute();
```

The filters, joins, and column references around the raw fragment stay checked; only the fragment itself is on you. And for the handful of queries where even that's awkward, keep calling `@clickhouse/client` directly for those specific queries. Partial migration is a stable end state, not a failure.

### 4. Regenerate types in CI to catch drift

This is what makes the migration pay off permanently. Add a CI step that regenerates the schema and fails if it changed:

```bash
npx hypequery generate
git diff --exit-code src/generated/schema.ts
npx tsc --noEmit
```

If someone renames a column in ClickHouse, the next CI run fails in one of two ways: the generated file differs from what's committed (schema changed, types weren't regenerated), or `tsc` fails (types were regenerated, call sites weren't updated). Either way, drift is a red build instead of a `NaN` in production. Run it against staging on a schedule too, so schema changes surface before the first deploy that depends on them.

## What you're trading

Being honest about the costs: you're adding a dependency and a generated file to maintain, your team has to learn a builder API on top of the SQL they already know, and queries that outgrow the builder need an escape hatch or a drop back to raw SQL. If your analytics surface is five stable queries that never change, raw SQL with careful code review is genuinely fine — the [full raw SQL comparison](/compare/hypequery-vs-raw-sql) works through where the break-even point sits. The migration earns its keep when queries are numerous, frequently edited, or maintained by more people than wrote them.

## Where to go from here

- [Quick start](/docs/quick-start) — the generate → typed builder workflow from zero.
- [hypequery vs raw SQL](/compare/hypequery-vs-raw-sql) — the full tradeoff analysis behind this guide.
- [hypequery vs @clickhouse/client](/compare/hypequery-vs-clickhouse-client) — how the builder relates to the official client it's built on.
- [Turn your ClickHouse schema into a type-safe analytics layer in 5 minutes](/blog/turn-your-clickhouse-schema-into-a-type-safe-analytics-layer-in-5-minutes) — the regenerate loop demonstrated on a fresh project.
