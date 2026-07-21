---
title: "Migrating from Kysely to hypequery for ClickHouse"
description: "A practical migration guide for moving ClickHouse queries from Kysely to hypequery: idiom-by-idiom mapping, generated schema types, what you gain, and what you honestly give up."
seoTitle: "Kysely to hypequery: A ClickHouse Migration Guide"
seoDescription: "Moving from Kysely to hypequery for ClickHouse? Map selectFrom to table, executeTakeFirst to limit(1), and hand-written interfaces to generated types — with honest notes on what you lose."
pubDate: 2026-07-18
heroImage: ""
slug: migrating-kysely-to-hypequery
status: published
tags:
  - ClickHouse
  - TypeScript
---

**Short answer:** migrating Kysely queries to hypequery is mostly mechanical. `db.selectFrom('t')` becomes `db.table('t')`, `.selectAll()` becomes `.select('*')`, SQL operators like `'='` become named operators like `'eq'`, and `.executeTakeFirst()` becomes `.limit(1)` plus destructuring. The one structural change is that you delete your hand-written table interfaces and replace them with a schema generated from your live ClickHouse instance.

This post assumes you've already decided to switch. If you're still evaluating whether hypequery is the right move for your ClickHouse workload, the [hypequery vs Kysely comparison](/compare/hypequery-vs-kysely) covers that decision — this page is the how, not the why.

The migration takes roughly this shape: install and generate types, swap the client, port queries file by file using the mapping table below, then delete the interfaces you used to maintain by hand. The two clients can coexist during the transition, so nothing forces a big-bang rewrite. If you want to see the generated types before committing to porting anything, the [quick start](/docs/quick-start) gets you from install to a typed query in a few minutes.

## Step 1: generate your schema

The biggest day-to-day difference isn't query syntax — it's where your types come from. Running Kysely against ClickHouse (via a community dialect or the MySQL wire protocol) means writing the `Database` interface yourself:

```ts
// Kysely on ClickHouse: hand-maintained, hand-guessed
interface OrdersTable {
  id: string;
  tenant_id: number;
  region: string;
  status: string;
  total: number;      // is this what ClickHouse actually returns? (often no)
  created_at: Date;   // ClickHouse returns a string over HTTP
}

interface Database {
  orders: OrdersTable;
}
```

These interfaces drift from the real schema, and worse, they encode what you *assume* ClickHouse returns rather than what it actually returns. hypequery replaces them with introspection:

```bash
npx hypequery generate
# connects to ClickHouse, introspects your tables, writes generated/schema.ts
```

Re-run `npx hypequery generate` whenever the schema changes. The generated types encode ClickHouse's runtime behavior over HTTP: `UInt64` comes back as a **string** in JavaScript (it can exceed `Number.MAX_SAFE_INTEGER`), `DateTime` comes back as a formatted string, and `Nullable(T)` becomes `T | null`. If your Kysely interfaces typed a `UInt64` column as `number`, you had a latent precision bug — the generated schema makes that class of mistake unrepresentable. The [ClickHouse TypeScript guide](/clickhouse-typescript) goes deeper on these mappings.

## Step 2: swap the client

```ts
import { createQueryBuilder } from '@hypequery/clickhouse';
import type { IntrospectedSchema } from './generated/schema.js';

const db = createQueryBuilder<IntrospectedSchema>({
  url: process.env.CLICKHOUSE_URL!,
  username: process.env.CLICKHOUSE_USERNAME!,
  password: process.env.CLICKHOUSE_PASSWORD,
  database: process.env.CLICKHOUSE_DATABASE!,
});
```

This talks to ClickHouse over its native HTTP interface via `@clickhouse/client` — no dialect adapter, no MySQL-compat port.

## The idiom mapping table

| Kysely | hypequery |
|---|---|
| `db.selectFrom('orders')` | `db.table('orders')` |
| `.selectAll()` | `.select('*')` |
| `.select(['region', 'status'])` | `.select(['region', 'status'])` |
| `.where('status', '=', 'completed')` | `.where('status', 'eq', 'completed')` |
| `.where('total', '>=', 100)` | `.where('total', 'gte', 100)` |
| `.where('region', 'in', regions)` | `.where('region', 'in', regions)` |
| `fn.sum('total').as('revenue')` | `.sum('total', 'revenue')` |
| `.innerJoin('users', 'users.id', 'orders.user_id')` | `.innerJoin('users', 'user_id', 'users.id')` |
| `.orderBy('created_at', 'desc')` | `.orderBy('created_at', 'DESC')` |
| `.executeTakeFirst()` | `.limit(1)` + `.execute()`, then destructure |
| `` sql`...` `` template tag | `selectExpr()`, `rawAs()`, `raw()` helpers |
| Hand-written `Database` interface | Generated `IntrospectedSchema` |

The operator strings are the change your fingers will notice most. hypequery uses named operators — `eq`, `neq`, `gt`, `gte`, `lt`, `lte`, `in`, `notIn`, `like`, `between` — instead of SQL symbols. They autocomplete, and the value side is type-checked against the column, so `where('total', 'between', ...)` demands a two-element tuple. The full list is in the [filter operators guide](/blog/clickhouse-filter-operators-typescript).

## Porting a typical query

A representative Kysely aggregation:

```ts
// Kysely
const revenue = await db
  .selectFrom('orders')
  .select(({ fn }) => [
    'region',
    fn.sum('total').as('revenue'),
    fn.count('id').as('order_count'),
  ])
  .where('status', '=', 'completed')
  .where('created_at', '>=', startDate)
  .groupBy('region')
  .orderBy('revenue', 'desc')
  .execute();
```

The hypequery equivalent:

```ts
// hypequery
const revenue = await db
  .table('orders')
  .select(['region'])
  .sum('total', 'revenue')
  .count('id', 'order_count')
  .where('status', 'eq', 'completed')
  .where('created_at', 'gte', startDate)
  .groupBy('region')
  .orderBy('revenue', 'DESC')
  .execute();
```

Aggregations move from Kysely's expression-builder callback to first-class chained methods that take `(column, alias)`. Beyond `sum`/`count`, the builder ships `avg`, `min`, `max`, `countDistinct`, `quantile`, `stddev`, `variance`, and ClickHouse's `argMax`/`argMin` — that last pair has no Kysely equivalent short of raw SQL.

## The executeTakeFirst() habit

The method Kysely users reach for reflexively doesn't exist in hypequery. The replacement is one extra line:

```ts
// Kysely
const order = await db
  .selectFrom('orders')
  .selectAll()
  .where('id', '=', orderId)
  .executeTakeFirst();

// hypequery
const [order] = await db
  .table('orders')
  .select('*')
  .where('id', 'eq', orderId)
  .limit(1)
  .execute();
// order: OrderRow | undefined — same contract as executeTakeFirst()
```

The `.limit(1)` matters: without it, ClickHouse scans and returns every matching row and you throw away all but the first in application code. Array destructuring gives you the same `T | undefined` shape `executeTakeFirst()` returned, so downstream null-checks port unchanged. There's a dedicated post on this pattern, including the `executeTakeFirstOrThrow` equivalent, at [executeTakeFirst() in hypequery](/blog/clickhouse-executetakefirst-hypequery).

## Raw SQL escape hatches

Where you used Kysely's `sql` template tag inside a select, hypequery's standalone helpers do the same job:

```ts
import { selectExpr } from '@hypequery/clickhouse';

const ranked = await db
  .table('orders')
  .select([
    'region',
    selectExpr('ROW_NUMBER() OVER (PARTITION BY region ORDER BY total DESC)', 'rank'),
  ])
  .execute();
```

`selectExpr(sql, alias)` covers aliased expressions, `rawAs` and `raw` cover the rest. One honest note: window functions are not first-class builder methods in hypequery — `selectExpr` with an `OVER (...)` clause is the supported path, same as it was with Kysely's template tag.

## What you gain

**ClickHouse clauses Kysely never modeled.** These are native builder methods, not string escapes:

```ts
// Top 3 orders per region — ClickHouse LIMIT BY, no window function needed
const top3 = await db
  .table('orders')
  .select(['region', 'id', 'total'])
  .orderBy('total', 'DESC')
  .limitBy(3, 'region')
  .execute();

// Deduplicated reads from a ReplacingMergeTree
const current = await db
  .table('orders')
  .select('*')
  .final()
  .where('tenant_id', 'eq', tenantId)
  .execute();

// PREWHERE: filter cheap columns before reading wide ones
const events = await db
  .table('events')
  .select(['event_type', 'properties'])
  .prewhere('tenant_id', 'eq', tenantId)
  .where('event_type', 'eq', 'page_view')
  .execute();
```

Add `.groupByTimeInterval('created_at', '1 day')` for time-series bucketing, `.withTotals()`, `.settings()`, and `.withCTE()` for typed CTEs. With Kysely, each of these was a raw-SQL fragment or simply unavailable.

**Layers above the builder.** Kysely stops at the query. hypequery's optional packages continue upward: `@hypequery/serve` turns queries into validated HTTP routes with zod input schemas and OpenAPI docs, and `@hypequery/react` provides TanStack Query hooks against those routes. If your Kysely queries currently feed hand-rolled Express endpoints and hand-typed fetch calls, this is where the migration pays for itself twice.

**Types that match the wire.** Covered above, but it's the compounding win: every ported query gets result types that reflect what ClickHouse actually sends, not what an interface author hoped.

## What you lose — honestly

**Multi-dialect portability.** Kysely speaks Postgres, MySQL, SQLite, and MSSQL from one API. hypequery is ClickHouse-only, by design. If one Kysely codebase was serving both your OLTP database and ClickHouse, you'll now run two libraries — which is the standard pattern anyway (Kysely or Prisma for OLTP, a ClickHouse-native layer for analytics), but it is one more dependency.

**Transactions.** Kysely's `db.transaction().execute(...)` has no hypequery equivalent. ClickHouse itself doesn't offer meaningful multi-statement transactions, so you weren't getting real transactional semantics through Kysely on ClickHouse either — but if any of your Kysely code relied on transactions, that code belongs on your OLTP database, not in this migration.

**The plugin ecosystem.** Kysely's plugin system (camelCase conversion, community plugins), its migration tooling, and its breadth of community dialects have no counterpart here. hypequery's surface is narrower and ClickHouse-shaped. If your workflow leaned on Kysely plugins for cross-cutting query transforms, budget time to replace those behaviors explicitly.

If any of these are dealbreakers, that's a signal to revisit the [comparison page](/compare/hypequery-vs-kysely) rather than push through the migration.

## A migration checklist

1. `npx hypequery generate` — introspect the schema, inspect it, compare against your hand-written interfaces (expect to find drift).
2. Create the hypequery client alongside your Kysely instance. Both can run in the same process.
3. Port one query module at a time using the mapping table. The compiler flags every column typo and operator mismatch as you go.
4. Grep for `executeTakeFirst` and convert each site to `.limit(1)` + destructure.
5. Grep for `` sql` `` usages and convert to `selectExpr`/`rawAs`/`raw` — then check whether `limitBy`, `final`, `prewhere`, or `groupByTimeInterval` eliminates the raw SQL entirely.
6. Delete the hand-written `Database` interface. Wire `npx hypequery generate` into CI so schema drift fails the build instead of surfacing in production.

## Where to go from here

- [Quick start](/docs/quick-start) — install, introspect, first typed query.
- [ClickHouse query builder guide](/clickhouse-query-builder) — the full builder surface beyond what this migration touched.
- [ClickHouse + React](/clickhouse-react) — the hooks layer, if you're replacing hand-typed fetch calls next.
- [Building a ClickHouse API](/clickhouse-api) — turning ported queries into governed HTTP routes with @hypequery/serve.
