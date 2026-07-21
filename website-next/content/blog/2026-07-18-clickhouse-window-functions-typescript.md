---
title: "ClickHouse Window Functions in TypeScript"
description: "How to use row_number(), rank(), dense_rank(), and lagInFrame() in ClickHouse, and how to run window functions from a type-safe TypeScript query builder with hypequery."
seoTitle: "ClickHouse Window Functions: row_number, rank, lag in TypeScript"
seoDescription: "ClickHouse window functions explained: row_number(), rank(), dense_rank(), and the lagInFrame()/leadInFrame() naming gotcha, with SQL and type-safe TypeScript examples."
pubDate: 2026-07-18
heroImage: ""
slug: clickhouse-window-functions-typescript
status: published
tags:
  - ClickHouse
  - TypeScript
---

ClickHouse supports standard SQL window functions: `row_number()`, `rank()`, `dense_rank()`, and aggregate functions with an `OVER (...)` clause all work the way you'd expect from Postgres. There are two things that trip people up.

**Short answer:** first, ClickHouse names its lag/lead functions `lagInFrame()` and `leadInFrame()`, and they read from the window *frame*, so you almost always want an explicit `ROWS BETWEEN ...` clause with them. Plain `lag()` and `lead()` may simply not exist depending on your ClickHouse version, so treat the `InFrame` variants as the portable names. Second, if you're using hypequery, window functions are not first-class builder methods — there is no `.rowNumber()` or `.over()`. You write the window expression as raw SQL with `selectExpr()` inside an otherwise fully typed query. That's an honest escape hatch, not a hidden feature.

This post shows the SQL first for the three scenarios that come up constantly in analytics work — ranking products per region, ordering events within a session, and running totals — then the hypequery equivalent for each. If you don't have a typed ClickHouse setup yet, the [quick start](/docs/quick-start) gets you from schema to generated TypeScript types in a few minutes, and the [ClickHouse query builder](/clickhouse-query-builder) page covers what the builder does natively.

## How window functions work in ClickHouse

A window function computes a value for each row using a set of related rows — the window — without collapsing them the way `GROUP BY` does. The `OVER` clause has three parts:

```sql
function() OVER (
  PARTITION BY region          -- restart the calculation per group
  ORDER BY revenue DESC        -- ordering within each partition
  ROWS BETWEEN ... AND ...     -- the frame: which rows the function can see
)
```

The frame is the part most people ignore, and in ClickHouse ignoring it will bite you with `leadInFrame()` — more on that below.

## Ranking products per region: row_number(), rank(), dense_rank()

Say you have a `product_sales` table with `region`, `product`, and `revenue`, and you want each product's position within its region by revenue:

```sql
SELECT
  region,
  product,
  revenue,
  row_number() OVER (PARTITION BY region ORDER BY revenue DESC) AS position,
  rank()       OVER (PARTITION BY region ORDER BY revenue DESC) AS rank,
  dense_rank() OVER (PARTITION BY region ORDER BY revenue DESC) AS dense_rank
FROM product_sales
ORDER BY region, position
```

The three differ only in how they treat ties:

- `row_number()` — unique sequential numbers; ties are broken arbitrarily (1, 2, 3, 4)
- `rank()` — ties share a rank, and the next rank skips (1, 2, 2, 4)
- `dense_rank()` — ties share a rank with no gap (1, 2, 2, 3)

In hypequery, the window expression goes through `selectExpr()` inside `.select([...])`. Everything else — the table name, the plain columns, the ordering — stays typed:

```ts
import { createQueryBuilder, selectExpr } from '@hypequery/clickhouse';
import type { IntrospectedSchema } from './generated/schema.js';

const db = createQueryBuilder<IntrospectedSchema>({
  url: process.env.CLICKHOUSE_URL!,
  username: process.env.CLICKHOUSE_USERNAME!,
  password: process.env.CLICKHOUSE_PASSWORD,
  database: process.env.CLICKHOUSE_DATABASE!,
});

const ranked = await db
  .table('product_sales')
  .select([
    'region',
    'product',
    'revenue',
    selectExpr(
      'row_number() OVER (PARTITION BY region ORDER BY revenue DESC)',
      'position'
    ),
  ])
  .orderBy('region', 'ASC')
  .execute();
```

To be clear about what you get: `region`, `product`, and `revenue` are checked against your generated schema, so a typo fails at compile time. The `selectExpr()` string is not parsed or validated — if you misspell `PARTITION`, you find out at runtime. And `row_number()` returns a `UInt64`, which ClickHouse serializes as a **string** in JSON output, so compare `position` as a string (or convert) in your application code.

### Filtering to the top N per region

One classic mistake: you can't put a window function result in `WHERE`, because `WHERE` runs before window functions are evaluated. In SQL you either wrap the query in a subquery, or on recent ClickHouse versions use `QUALIFY`:

```sql
SELECT
  region,
  product,
  revenue,
  row_number() OVER (PARTITION BY region ORDER BY revenue DESC) AS position
FROM product_sales
QUALIFY position <= 3
```

But if top-N-per-group is *all* you need, step back: ClickHouse has a native `LIMIT BY` clause that does exactly this without a window function, and hypequery supports it as a first-class method:

```ts
const top3PerRegion = await db
  .table('product_sales')
  .select(['region', 'product', 'revenue'])
  .orderBy('revenue', 'DESC')
  .limitBy(3, 'region')
  .execute();
```

That version stays entirely inside the typed builder — no raw SQL string. We cover the trade-offs in [ClickHouse LIMIT BY in TypeScript](/blog/clickhouse-limit-by-typescript). Reach for `row_number()` when you actually need the rank *value* in your results (for display, or to join against later), not just the trimmed rows.

## lagInFrame() and leadInFrame(): the naming gotcha

In Postgres you'd write `lag(created_at)` to get the previous row's timestamp. In ClickHouse, the reliable names are `lagInFrame()` and `leadInFrame()`. Depending on your ClickHouse version, plain `lag()` and `lead()` may not exist at all — if you're writing SQL that has to work across versions, use the `InFrame` variants.

The name is a warning label: these functions read from the window **frame**, not from the partition as a whole. ClickHouse's default frame ends at the current row, which means `leadInFrame()` with a default frame can't see the next row and silently returns the default value instead. `lagInFrame()` happens to work with the default frame, but the safe habit is to always spell the frame out:

```sql
SELECT
  user_id,
  session_id,
  event_type,
  created_at,
  row_number() OVER (
    PARTITION BY user_id, session_id ORDER BY created_at
  ) AS event_index,
  lagInFrame(created_at, 1) OVER (
    PARTITION BY user_id, session_id ORDER BY created_at
    ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW
  ) AS previous_event_at
FROM events
ORDER BY user_id, session_id, created_at
```

This is the standard session-ordering pattern: number each event within a session, and carry the previous event's timestamp alongside so you can compute the gap between steps (wrap the two timestamps in `dateDiff('second', ...)` for that — see [ClickHouse date functions in TypeScript](/blog/clickhouse-date-functions-typescript) for the boundary-crossing semantics of `dateDiff`).

The hypequery version — same shape, window expressions via `selectExpr()`:

```ts
const sessionEvents = await db
  .table('events')
  .select([
    'user_id',
    'session_id',
    'event_type',
    'created_at',
    selectExpr(
      'row_number() OVER (PARTITION BY user_id, session_id ORDER BY created_at)',
      'event_index'
    ),
    selectExpr(
      `lagInFrame(created_at, 1) OVER (
        PARTITION BY user_id, session_id ORDER BY created_at
        ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW
      )`,
      'previous_event_at'
    ),
  ])
  .where('created_at', 'gte', '2026-07-01 00:00:00')
  .orderBy('created_at', 'ASC')
  .execute();
```

The `.where()` filter is still typed and parameterized — only the two window expressions are raw strings.

## Running totals

Cumulative sums are the third everyday window use case. Given a `daily_revenue` table with one row per `region` per `day`:

```sql
SELECT
  region,
  day,
  revenue,
  sum(revenue) OVER (
    PARTITION BY region
    ORDER BY day
    ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW
  ) AS running_revenue
FROM daily_revenue
ORDER BY region, day
```

Note the explicit `ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW`. With `ORDER BY` and no frame clause, the default frame is `RANGE`-based, which treats rows with equal `day` values as peers and includes all of them in the sum. With one row per region per day that's the same result, but the moment duplicates appear the two frames diverge — writing `ROWS` makes the intent unambiguous.

```ts
const runningRevenue = await db
  .table('daily_revenue')
  .select([
    'region',
    'day',
    'revenue',
    selectExpr(
      `sum(revenue) OVER (
        PARTITION BY region ORDER BY day
        ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW
      )`,
      'running_revenue'
    ),
  ])
  .where('day', 'gte', '2026-01-01')
  .orderBy('day', 'ASC')
  .execute();
```

## Where hypequery stands on window functions

To restate it plainly: hypequery has no dedicated window-function API today. `selectExpr()` is the supported path, and it composes with everything else the builder does — typed filters, joins, `groupBy`, caching, `toSQL()` for inspection. What you give up inside the `selectExpr()` string is compile-time checking of that one expression; what you keep is type safety on every other part of the query.

Two related notes before you reach for a window function at all:

- For percentiles over a whole result set (p95 latency, median order value), you don't need `OVER (...)` — ClickHouse's [quantile()](/clickhouse/functions/quantile) is a plain aggregate, and hypequery exposes it natively as `.quantile(column, level, alias)`.
- For top-N-per-group, `LIMIT BY` (native `.limitBy()`) is usually simpler and cheaper than `row_number()` plus a filter.

Window functions earn their keep when the row-relative value itself matters: rank numbers you display, previous-row deltas, cumulative series.

## Where to go from here

- [ClickHouse LIMIT BY in TypeScript](/blog/clickhouse-limit-by-typescript) — the ClickHouse-native alternative for top-N-per-group
- [ClickHouse query builder](/clickhouse-query-builder) — what hypequery's builder covers natively, and where the escape hatches are
- [ClickHouse with TypeScript](/clickhouse-typescript) — the full picture: generated types, runtime type mappings, and the query builder
- [quantile()](/clickhouse/functions/quantile) — percentile aggregates without window functions
