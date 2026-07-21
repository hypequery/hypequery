---
title: "ClickHouse LIMIT BY — Top-N-Per-Group Queries in TypeScript"
description: "LIMIT BY is ClickHouse's built-in answer to top-N-per-group: latest 3 events per user, top 5 products per category. Learn how it works, how it differs from LIMIT and row_number(), and how to write it in TypeScript with hypequery's native .limitBy()."
seoTitle: "ClickHouse LIMIT BY Explained: Top-N Per Group in TypeScript"
seoDescription: "ClickHouse LIMIT BY returns the first N rows per group — no window functions needed. Syntax, semantics, LIMIT BY vs LIMIT, row_number() comparison, and type-safe TypeScript examples."
pubDate: 2026-07-18
heroImage: ""
slug: clickhouse-limit-by-typescript
status: published
tags:
  - ClickHouse
  - TypeScript
---

`LIMIT BY` is a ClickHouse-specific clause that returns the first N rows *for each distinct value* of one or more columns. Standard SQL has no equivalent — everywhere else, "top N per group" means a `row_number()` window function wrapped in a subquery.

**Short answer:** `LIMIT n BY col` keeps the first `n` rows per value of `col`, in whatever order your `ORDER BY` established. It runs *before* the final `LIMIT`, so you can cap rows per group and total rows in the same query:

```sql
SELECT user_id, event_type, created_at
FROM events
ORDER BY user_id, created_at DESC
LIMIT 3 BY user_id   -- at most 3 rows per user
LIMIT 100            -- at most 100 rows overall
```

Most TypeScript query builders can't express this clause at all, because they target the standard-SQL feature set. hypequery supports it natively with `.limitBy()`:

```typescript
const latestEvents = await db
  .table('events')
  .select(['user_id', 'event_type', 'created_at'])
  .orderBy('user_id', 'ASC')
  .orderBy('created_at', 'DESC')
  .limitBy(3, 'user_id')
  .limit(100)
  .execute();
```

No subquery, no window function, no raw SQL string. If you want to run these examples against your own schema, the [quick start](/docs/quick-start) gets you from `npm install` to typed queries in a few minutes, and the [ClickHouse query builder guide](/clickhouse-query-builder) covers the rest of the builder surface.

This post covers what `LIMIT BY` actually does, the two scenarios where it shines, how it interacts with the final `LIMIT`, and when you should reach for `row_number()` instead.

## What LIMIT BY Does

The clause is:

```sql
LIMIT n BY expressions
```

ClickHouse processes the query as usual — filters, aggregation, `ORDER BY` — and then, for each distinct value of the `BY` expressions, keeps only the first `n` rows and discards the rest.

Two things follow from that:

1. **Order determines survivors.** `LIMIT BY` keeps the *first* `n` rows per group as they appear after `ORDER BY`. If you want the latest 3 events per user, you must sort by `created_at DESC` first. Without an `ORDER BY`, which rows survive is arbitrary.
2. **It is not `LIMIT`.** `LIMIT` caps the total result. `LIMIT BY` caps rows per group and puts no ceiling on the total: 10,000 users × `LIMIT 3 BY user_id` is up to 30,000 rows. That's why the two clauses compose — more on that below.

ClickHouse also accepts an offset form in SQL (`LIMIT 1, 3 BY user_id` skips the first row per group, then takes three). It's rarely needed; hypequery's `.limitBy()` covers the standard `LIMIT n BY` form, which is what almost every real query uses.

## Scenario 1: Latest 3 Events Per User

The canonical case. You have an events table:

```sql
CREATE TABLE events (
  tenant_id UInt32,
  user_id String,
  event_type String,
  page_path String,
  created_at DateTime
) ENGINE = MergeTree()
ORDER BY (tenant_id, user_id, created_at);
```

"Show me each user's three most recent events" in plain SQL:

```sql
SELECT user_id, event_type, page_path, created_at
FROM events
WHERE tenant_id = 42
ORDER BY user_id, created_at DESC
LIMIT 3 BY user_id
```

And in hypequery, fully typed against your generated schema:

```typescript
import { createQueryBuilder } from '@hypequery/clickhouse';
import type { IntrospectedSchema } from './generated/schema.js';

const db = createQueryBuilder<IntrospectedSchema>({
  url: process.env.CLICKHOUSE_URL!,
  username: process.env.CLICKHOUSE_USERNAME!,
  password: process.env.CLICKHOUSE_PASSWORD,
  database: process.env.CLICKHOUSE_DATABASE!,
});

const recentActivity = await db
  .table('events')
  .select(['user_id', 'event_type', 'page_path', 'created_at'])
  .where('tenant_id', 'eq', 42)
  .orderBy('user_id', 'ASC')
  .orderBy('created_at', 'DESC')
  .limitBy(3, 'user_id')
  .execute();
```

Column names in `.select()`, `.orderBy()`, and `.limitBy()` are all checked against the `events` table type — a typo like `.limitBy(3, 'userid')` fails at compile time, not at 2am in production.

The `ORDER BY user_id, created_at DESC` pair is doing real work here: sorting by `user_id` first groups each user's rows together, and `created_at DESC` within each user means the "first 3" that `LIMIT BY` keeps are the newest 3.

## Scenario 2: Top 5 Products Per Category

`LIMIT BY` also works after aggregation, which makes it a clean fit for leaderboard-style queries. Given an `order_items` table with `tenant_id`, `category`, `product_name`, and `revenue`:

```sql
SELECT category, product_name, sum(revenue) AS total_revenue
FROM order_items
GROUP BY category, product_name
ORDER BY category, total_revenue DESC
LIMIT 5 BY category
```

Every category gets its five highest-revenue products. The hypequery version:

```typescript
const topProducts = await db
  .table('order_items')
  .select(['category', 'product_name'])
  .sum('revenue', 'total_revenue')
  .groupBy(['category', 'product_name'])
  .orderBy('category', 'ASC')
  .orderBy('total_revenue', 'DESC')
  .limitBy(5, 'category')
  .execute();
```

This shape — aggregate, rank within a group, keep the top N — is what powers "top pages per tenant", "top errors per service", "top referrers per campaign". In standard SQL each of those is a two-level query with a window function. In ClickHouse it's one flat query.

`.limitBy()` also accepts multiple columns when the group is compound. Top 5 products per category *per tenant*:

```typescript
.limitBy(5, ['tenant_id', 'category'])
```

which renders as `LIMIT 5 BY tenant_id, category`.

## LIMIT BY Runs Before LIMIT

The two clauses stack, and the order matters: ClickHouse applies `LIMIT BY` first, then the final `LIMIT` on whatever remains.

```typescript
const feed = await db
  .table('events')
  .select(['user_id', 'event_type', 'created_at'])
  .where('tenant_id', 'eq', 42)
  .orderBy('created_at', 'DESC')
  .limitBy(3, 'user_id')  // step 1: at most 3 rows per user
  .limit(100)             // step 2: at most 100 rows total
  .execute();
```

Read it as: "build an activity feed where no single user occupies more than three slots, capped at 100 entries." Without the `LIMIT BY`, one chatty user could fill the entire feed; without the `LIMIT`, a busy tenant could return tens of thousands of rows. Together they give you fairness *and* a bounded payload — useful for any API response, and it composes with the cursor patterns from the [pagination guide](/blog/clickhouse-pagination-typescript).

One more practical use: deduplication. On a `ReplacingMergeTree` table where updates arrive as new row versions, `ORDER BY id, updated_at DESC` + `LIMIT 1 BY id` returns exactly one — the latest — row per id, without paying the cost of `FINAL`:

```typescript
const currentState = await db
  .table('user_profiles')
  .select(['id', 'plan', 'updated_at'])
  .orderBy('id', 'ASC')
  .orderBy('updated_at', 'DESC')
  .limitBy(1, 'id')
  .execute();
```

## LIMIT BY vs row_number()

The portable way to write top-N-per-group is a window function:

```sql
SELECT user_id, event_type, created_at
FROM (
  SELECT
    user_id,
    event_type,
    created_at,
    row_number() OVER (PARTITION BY user_id ORDER BY created_at DESC) AS rn
  FROM events
  WHERE tenant_id = 42
) ranked
WHERE rn <= 3
```

This works in ClickHouse too, and hypequery can express it via `selectExpr` — the [window functions guide](/blog/clickhouse-window-functions-typescript) walks through the pattern in detail. But compare it honestly with the `LIMIT BY` version:

- **Simplicity.** `LIMIT BY` is one clause on a flat query. The window version needs a subquery, a synthetic `rn` column you usually don't want in the output, and an outer filter.
- **Performance.** `LIMIT BY` can discard rows as soon as a group has produced its `n` survivors. `row_number()` materializes a rank for *every* row in every partition before the outer `WHERE` throws most of them away. On large event tables the difference is often measurable; on small ones it's noise.
- **Builder support.** `.limitBy(3, 'user_id')` is native and fully typed. The window version routes through a raw SQL expression inside `selectExpr`, which works but gives up column-name checking inside the `OVER (...)` clause.

When do you still want `row_number()`?

- **You need the rank itself in the output** — "show each product's position within its category" requires the number, not just the top slice.
- **You need other window machinery** — `lag()`/`lead()` for deltas, running sums, moving averages, or frame clauses. `LIMIT BY` only ever answers "keep the first N per group".
- **The SQL must be portable** to Postgres or another engine. `LIMIT BY` is ClickHouse-only.

The practical rule: if the question is "give me N rows per group", use `LIMIT BY` and be done. Reach for window functions when you need the rank as data or a computation across the window.

## Why Most Builders Can't Do This

`LIMIT BY` doesn't exist in standard SQL, so query builders designed around the common denominator — Kysely, Knex, and the ORM query APIs — have no method for it. Your options there are a raw SQL fragment or restructuring the query around a window-function subquery, at which point the builder is mostly decoration.

This is a recurring theme with ClickHouse: the features that make it worth choosing (`LIMIT BY`, `FINAL`, `PREWHERE`, `argMax`, `arrayJoin`) are exactly the ones generic tools omit. hypequery's builder is ClickHouse-only by design, so these get first-class, typed methods instead of escape hatches — the same reason `.final()` and `.arrayJoin()` exist as real methods. The [ClickHouse TypeScript guide](/clickhouse-typescript) covers that design position in full.

## Where to Go From Here

- [ClickHouse window functions in TypeScript](/blog/clickhouse-window-functions-typescript) — when you need ranks, lag/lead, or running totals instead of a top-N slice.
- [ClickHouse pagination in TypeScript](/blog/clickhouse-pagination-typescript) — combining `LIMIT`, `OFFSET`, and cursors for API responses.
- [Filter operators in the hypequery builder](/blog/clickhouse-filter-operators-typescript) — the `.where()` surface used in every example above.
- [ClickHouse for product analytics](/clickhouse-product-analytics) — the broader event-analytics patterns that top-N-per-group queries feed into.
