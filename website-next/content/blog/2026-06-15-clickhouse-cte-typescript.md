---
title: "ClickHouse CTEs in TypeScript — WITH Clause Patterns"
description: "How WITH clauses actually behave in ClickHouse (inlined, not materialized), and how to build typed CTEs in TypeScript with hypequery's .withCTE() — including builder-as-subquery composition, cohort retention joins, and reusable filtered subsets."
seoTitle: "ClickHouse CTE in TypeScript: WITH Clause Patterns That Work"
seoDescription: "ClickHouse CTEs explained for TypeScript developers: inlining semantics, scalar WITH expressions, and type-safe WITH clauses using hypequery's native .withCTE() with query builders or raw SQL."
pubDate: 2026-06-15
heroImage: ""
slug: clickhouse-cte-typescript
status: published
tags:
  - ClickHouse
  - TypeScript
---

ClickHouse supports standard `WITH ... AS (...)` common table expressions, plus a second form most databases don't have: scalar `WITH` expressions that bind a single value to a name. Both work fine from TypeScript, and hypequery supports CTEs natively with `.withCTE(alias, subquery)` — where the subquery can be another typed QueryBuilder instance, not just a SQL string.

**Short answer:** ClickHouse CTEs are **inlined at each reference, not materialized**. When the query runs, the CTE body is substituted everywhere its name appears — so a CTE referenced twice is computed twice. Treat CTEs as a naming and composition tool, not a caching tool. In hypequery, that composition happens at the TypeScript level: build a typed subquery once, attach it with `.withCTE()`, and join against it like a table. The alias, the join columns, and the result types all stay checked.

If you don't have a typed ClickHouse setup yet, the [quick start](/docs/quick-start) takes you from a live schema to generated TypeScript types in a few minutes, and the [ClickHouse query builder](/clickhouse-query-builder) page covers the rest of the builder surface. This post focuses on WITH-clause patterns specifically.

## How ClickHouse actually executes a CTE

This is the part worth internalizing before writing any code. In Postgres (before version 12) a CTE was an optimization fence — computed once, materialized, then read by the outer query. ClickHouse does the opposite: the CTE is a macro. This query:

```sql
WITH signups AS (
  SELECT user_id, min(created_at) AS first_seen
  FROM events
  WHERE event_type = 'signup'
  GROUP BY user_id
)
SELECT count() FROM signups
```

executes exactly as if you had written the subquery inline. That has two practical consequences:

1. **Zero-cost naming.** Using a CTE to give a subquery a readable name costs nothing at runtime. Use them freely for clarity.
2. **Repeated references repeat the work.** If `signups` appears twice in the outer query, ClickHouse scans and aggregates `events` twice. A CTE will not save you from a duplicated heavy computation.

The second point is where teams coming from Postgres get burned. Here's the anti-pattern:

```sql
WITH checkout_events AS (
  SELECT user_id, event_type
  FROM events
  WHERE tenant_id = 42
    AND event_type IN ('checkout_started', 'checkout_completed')
)
SELECT
  (SELECT count() FROM checkout_events WHERE event_type = 'checkout_started')  AS started,
  (SELECT count() FROM checkout_events WHERE event_type = 'checkout_completed') AS completed
```

Two references, two scans of `events`. The idiomatic ClickHouse fix is conditional aggregation in a single pass:

```sql
SELECT
  countIf(event_type = 'checkout_started')  AS started,
  countIf(event_type = 'checkout_completed') AS completed
FROM events
WHERE tenant_id = 42
  AND event_type IN ('checkout_started', 'checkout_completed')
```

Keep that rule in your head — reference a CTE once per query — and CTEs in ClickHouse are purely a readability and composition win.

## `.withCTE()` in hypequery: two forms

The setup, using types generated from your live schema:

```ts
import { createQueryBuilder, selectExpr } from '@hypequery/clickhouse';
import type { IntrospectedSchema } from './generated/schema.js';

const db = createQueryBuilder<IntrospectedSchema>({
  url: process.env.CLICKHOUSE_URL!,
  username: process.env.CLICKHOUSE_USERNAME!,
  password: process.env.CLICKHOUSE_PASSWORD,
  database: process.env.CLICKHOUSE_DATABASE!,
});
```

The examples below use this table:

```sql
CREATE TABLE events (
  tenant_id UInt32,
  user_id String,
  event_type LowCardinality(String),
  revenue Float64,
  created_at DateTime
) ENGINE = MergeTree()
ORDER BY (tenant_id, created_at);
```

### Form 1: a QueryBuilder as the CTE (the one you want)

The subquery is a normal typed builder. Column names are checked against your schema, filters go through the same operator validation as any other query, and the whole thing is a value you can store in a variable, export from a module, and reuse:

```ts
const signups = db
  .table('events')
  .select(['user_id'])
  .min('created_at', 'first_seen')
  .where('event_type', 'eq', 'signup')
  .groupBy('user_id');

const results = await db
  .table('events')
  .withCTE('signups', signups)
  .innerJoin('signups', 'user_id', 'signups.user_id')
  .select(['events.event_type'])
  .count('events.user_id', 'event_count')
  .groupBy('events.event_type')
  .execute();
```

`toSQL()` on that query produces a standard `WITH signups AS (SELECT ...) SELECT ...` statement, and the CTE alias joins like any table. This is the pattern to reach for: **compose typed subqueries the way you compose functions.** The `signups` builder is just data until something executes it, so defining it costs nothing, and any query in your codebase can pull it in.

### Form 2: a SQL string as the CTE

When the CTE body needs SQL the builder doesn't express first-class — window functions, for instance — pass a string. One structural note first: `.table()` starts the outer query from a real schema table and brings the CTE in through a join, so this form fits when the CTE is a **derived per-key table** that your base rows join against — one CTE row per join key, no fan-out. Here's a query that ranks users by lifetime revenue in the CTE, then keeps only the events belonging to the top 100 users:

```ts
const topUserEvents = await db
  .table('events')
  .withCTE(
    'user_rank',
    `SELECT
       user_id,
       row_number() OVER (ORDER BY sum(revenue) DESC) AS revenue_rank
     FROM events
     GROUP BY user_id`
  )
  .innerJoin('user_rank', 'user_id', 'user_rank.user_id')
  .select(['events.event_type'])
  .countDistinct('events.user_id', 'top_users')
  .where('user_rank.revenue_rank', 'lte', 100)
  .groupBy('events.event_type')
  .orderBy('event_type', 'ASC')
  .execute();
```

`user_rank` has exactly one row per user, so joining `events` against it on `user_id` matches each event to its single rank row — a normal key join, not a cross-product. The `revenue_rank <= 100` filter then keeps only events from the top users before the aggregation runs. The string form is the honest escape hatch: the CTE body itself isn't type-checked, but everything around it — the outer selects, join, filters — still is. If you're reaching for it because of `OVER (...)` clauses, the [window functions post](/blog/clickhouse-window-functions-typescript) covers that pattern in depth, including doing the window expression with `selectExpr()` instead.

## Pattern: cohort base + retention join

The classic CTE use case in product analytics: define a cohort once, then join activity against it. Here's weekly retention — for each signup cohort, how many users came back in each subsequent week:

```ts
const cohortBase = db
  .table('events')
  .select(['user_id'])
  .min('created_at', 'first_seen')
  .where('event_type', 'eq', 'signup')
  .where('created_at', 'gte', '2026-04-01 00:00:00')
  .groupBy('user_id');

const retention = await db
  .table('events')
  .withCTE('cohort', cohortBase)
  .innerJoin('cohort', 'user_id', 'cohort.user_id')
  .select([
    selectExpr('toStartOfWeek(cohort.first_seen)', 'cohort_week'),
    selectExpr("dateDiff('week', cohort.first_seen, events.created_at)", 'weeks_since_signup'),
  ])
  .countDistinct('events.user_id', 'active_users')
  .where('events.event_type', 'neq', 'signup')
  .groupBy(['cohort_week', 'weeks_since_signup'])
  .orderBy('cohort_week', 'ASC')
  .execute();
```

Generated shape:

```sql
WITH cohort AS (
  SELECT user_id, min(created_at) AS first_seen
  FROM events
  WHERE event_type = 'signup' AND created_at >= '2026-04-01 00:00:00'
  GROUP BY user_id
)
SELECT
  toStartOfWeek(cohort.first_seen) AS cohort_week,
  dateDiff('week', cohort.first_seen, events.created_at) AS weeks_since_signup,
  count(DISTINCT events.user_id) AS active_users
FROM events
INNER JOIN cohort ON events.user_id = cohort.user_id
WHERE events.event_type != 'signup'
GROUP BY cohort_week, weeks_since_signup
ORDER BY cohort_week ASC
```

Two things to notice. The cohort is referenced exactly once — the join — so the inlining semantics cost nothing. And `cohortBase` is an ordinary TypeScript value: your retention query, your churn query, and your activation funnel can all import the same cohort definition, which is the whole argument for building CTEs from typed builders instead of string templates. (Join mechanics, aliasing, and the ClickHouse-specific join gotchas get their own treatment in the [joins guide](/blog/clickhouse-joins-typescript).)

One dialect note: `dateDiff` counts calendar-boundary crossings, not elapsed time — a signup on Sunday 23:59 followed by activity on Monday 00:01 lands in week 1, not week 0. For retention bucketing that's usually what you want, but know it's boundary-based.

## Pattern: one filtered subset, many aggregations

The second scenario that comes up constantly: a filtered event subset — "billable events", "qualified sessions", "checkout funnel events" — that several different reports aggregate differently. Here the subset is just a **filter**, not a derived table you join against, so you don't need a CTE at all. Define the filtered builder once and chain a different aggregation onto it in each report. The reuse still lives in TypeScript, which is the whole point — and each report aggregates the subset directly instead of joining raw events back to it:

```ts
// shared definition — one place to update when "checkout event" changes
export const checkoutEvents = (tenantId: number) =>
  db
    .table('events')
    .where('tenant_id', 'eq', tenantId)
    .where('event_type', 'in', ['checkout_started', 'checkout_completed']);

// report 1: daily checkout revenue
const daily = await checkoutEvents(42)
  .select([selectExpr('toStartOfDay(created_at)', 'day')])
  .sum('revenue', 'daily_revenue')
  .groupBy(['day'])
  .orderBy('day', 'ASC')
  .execute();

// report 2: per-user checkout activity
const perUser = await checkoutEvents(42)
  .select(['user_id'])
  .count('event_type', 'checkout_events')
  .max('created_at', 'last_checkout')
  .groupBy(['user_id'])
  .execute();
```

Each report starts from the same filtered builder and adds only its own aggregation. The reuse lives in your codebase, where it's cheap, instead of in the SQL, where it isn't. When the definition of a checkout event changes — a new event type, an extra filter — you change one function and every report follows. Reach for `.withCTE()` here only when a report needs to *join* the subset against other data rather than aggregate it directly; then the subset becomes a named derived table, exactly like Form 1 above.

If a subset is genuinely expensive to compute and consumed by many queries per minute, a CTE is the wrong tool entirely; that's what materialized views are for. The [materialized views post](/blog/clickhouse-materialized-views-typescript) covers when to promote a hot CTE into one.

## Scalar WITH expressions

ClickHouse's second `WITH` form binds a scalar — a constant or a single-value subquery — to a name:

```sql
WITH 0.971 AS net_rate
SELECT sum(revenue) * net_rate AS net_revenue
FROM events
WHERE event_type = 'checkout_completed';

WITH (SELECT max(created_at) FROM events) AS latest
SELECT count() AS recent_events
FROM events
WHERE created_at > latest - INTERVAL 1 DAY;
```

From TypeScript, the constant case mostly dissolves: a scalar you'd name in SQL is just a variable in your app code, passed as a bound parameter through `.where()` or interpolated into a `selectExpr()`. The scalar-subquery case ("everything relative to the latest event") is a good fit for the SQL-string flavor when you need it inside a larger builder query — or often clearer as two round trips: fetch the scalar with a tiny query, then pass it as a parameter to the main one. Two fast queries you can read beat one clever one you can't.

## When to reach for which

- **Naming a subquery for readability** — CTE, always. It's free.
- **Joining derived data (cohorts, per-user rollups) into a query** — `.withCTE()` with a typed builder, joined once.
- **Reusing a subset across multiple reports** — share the builder in TypeScript; attach it per-query.
- **Same CTE referenced twice in one query** — restructure. Use conditional aggregation (`countIf`/`sumIf`) or a join instead; inlining means double the work.
- **Expensive computation consumed constantly** — materialized view, not a CTE.
- **CTE body needs window functions or other raw SQL** — string form of `.withCTE()`, keeping the outer query typed.

## Where to go from here

- [ClickHouse query builder](/clickhouse-query-builder) — the full builder surface `.withCTE()` composes with
- [ClickHouse JOINs in TypeScript](/blog/clickhouse-joins-typescript) — join types, aliasing, and how CTE aliases behave in joins
- [ClickHouse window functions in TypeScript](/blog/clickhouse-window-functions-typescript) — the most common reason a CTE body drops to raw SQL
- [Materialized views in TypeScript](/blog/clickhouse-materialized-views-typescript) — where a hot CTE should graduate to

Or start from zero: the [quick start](/docs/quick-start) generates types from your ClickHouse schema so every CTE you compose is checked before it runs.
