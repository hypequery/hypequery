---
title: "ClickHouse Sampling for Fast Prototyping in TypeScript"
description: "The ClickHouse SAMPLE clause reads a fraction of your data for near-instant estimates. Learn how SAMPLE BY works, how to scale results, and what to use from TypeScript — approximate aggregates in hypequery or raw SQL via @clickhouse/client."
seoTitle: "ClickHouse SAMPLE Clause: Fast Query Prototyping in TypeScript"
seoDescription: "How the ClickHouse SAMPLE clause works: SAMPLE BY table setup, scaling results, OFFSET slices, and the TypeScript options — approximate aggregates with hypequery or raw SAMPLE queries with @clickhouse/client."
pubDate: 2026-07-07
heroImage: ""
slug: clickhouse-sampling-typescript
status: published
tags:
  - ClickHouse
  - TypeScript
---

When you're iterating on an expensive analytics query, you don't need the exact answer on every run — you need a fast, roughly-right answer so you can keep iterating. That's what the ClickHouse `SAMPLE` clause is for.

**Short answer:** `SAMPLE 0.1` makes ClickHouse read about 10% of a table's data and run your query on that subset. It requires a `SAMPLE BY` clause in the table's DDL, and you must scale additive results (counts, sums) back up yourself. It's excellent for prototyping queries that would otherwise scan billions of rows.

Two honest caveats before the details. First, hypequery's query builder has **no `.sample()` method** — the `SAMPLE` clause is not part of the typed builder. Second, you often don't need it: ClickHouse's approximate aggregate functions ([`uniq()`](/clickhouse/functions/uniq), [`quantile()`](/clickhouse/functions/quantile)) give you the same "fast, roughly-right" property per aggregation, and hypequery supports those natively. When you genuinely need `SAMPLE`, drop to raw SQL with `@clickhouse/client`. This post covers both paths.

If you haven't set up a typed ClickHouse client yet, the [quick start](/docs/quick-start) gets you from schema to typed queries in a few minutes, and the [query builder guide](/clickhouse-query-builder) covers the day-to-day API.

## How SAMPLE works

`SAMPLE` is not random row skipping. ClickHouse samples deterministically based on a hash expression you declare in the table definition, which means the same `SAMPLE` clause returns the same subset every time (for the same data). That determinism is what makes it usable for iterative prototyping — your numbers don't jitter between runs.

The catch: sampling must be designed into the table. You need a `SAMPLE BY` clause in the DDL, and the sampling expression must be part of the sort key.

```sql
CREATE TABLE events (
  user_id UInt64,
  event_type LowCardinality(String),
  page_path String,
  duration_ms UInt32,
  created_at DateTime
) ENGINE = MergeTree()
ORDER BY (event_type, created_at, cityHash64(user_id))
SAMPLE BY cityHash64(user_id);
```

Rules worth knowing:

- The `SAMPLE BY` expression must appear in the `ORDER BY` (primary key) tuple.
- It should produce a uniformly distributed unsigned integer. Hashing an ID with `cityHash64` or `intHash32` is the standard pattern; sampling by a raw sequential ID skews the sample.
- Sampling by `cityHash64(user_id)` means you sample a subset of *users*, not a subset of rows. Every event for a sampled user is included, which keeps per-user aggregates (sessions, retention, distinct counts) coherent within the sample.

If the table wasn't created with `SAMPLE BY`, the `SAMPLE` clause errors. There's no way to bolt it on without rebuilding the table, which is one reason the approximate-aggregate path below is often the more practical option.

## The three forms of SAMPLE

**Fraction** — read roughly 10% of the data:

```sql
SELECT event_type, count() AS events
FROM events
SAMPLE 0.1
WHERE created_at >= now() - INTERVAL 7 DAY
GROUP BY event_type;
```

**Row count** — read enough data for approximately this many rows:

```sql
SELECT count() * any(_sample_factor) AS estimated_events
FROM events
SAMPLE 1000000;
```

ClickHouse translates the row target into a fraction internally, so it's approximate — and since you don't know the fraction, you scale with the `_sample_factor` virtual column instead of a hard-coded multiplier.

**Fraction with offset** — read a *different* 10% slice, starting halfway through the sample-key space:

```sql
SELECT count() AS events
FROM events
SAMPLE 0.1 OFFSET 0.5;
```

`OFFSET` is more useful than it looks. Two non-overlapping slices (`SAMPLE 0.1` vs `SAMPLE 0.1 OFFSET 0.5`) let you sanity-check an estimate: if both slices agree, your sampled numbers are probably trustworthy. Because the sampling is deterministic on the user hash, offsets also give you stable, non-overlapping user cohorts for quick A/B-style splits during exploration.

## Scaling the results

`SAMPLE 0.1` gives you 10% of the data, so additive aggregates come back at roughly 10% of their true value. You have to scale them:

```sql
-- Manual scaling: you know the fraction, multiply by its inverse
SELECT
  page_path,
  count() * 10 AS estimated_views
FROM events
SAMPLE 0.1
WHERE created_at >= now() - INTERVAL 7 DAY
GROUP BY page_path
ORDER BY estimated_views DESC
LIMIT 20;

-- Or let ClickHouse tell you the factor
SELECT
  page_path,
  count() * any(_sample_factor) AS estimated_views
FROM events
SAMPLE 0.1
GROUP BY page_path;
```

What needs scaling and what doesn't:

- **Scale:** `count()`, `sum()` — anything additive.
- **Don't scale:** `avg()`, quantiles, ratios — anything already normalized per row.
- **Roughly scale:** `uniq(user_id)` under a user-hash sample key — you sampled 10% of users, so multiply distinct-user counts by 10 for an estimate.

Forgetting to scale is the classic SAMPLE bug: a dashboard prototype that quietly reports one tenth of real revenue. Keep the multiplier next to the `SAMPLE` clause so they can't drift apart.

## hypequery has no .sample() — here's what to do instead

Plainly: the hypequery builder does not expose the `SAMPLE` clause. There is no `.sample()` method, and we'd rather say that than have you discover it mid-prototype. You have two honest options from TypeScript.

### Option 1: approximate aggregates (usually the better answer)

Most of the time, the reason you reached for `SAMPLE` is that an exact aggregate over billions of rows is slow — usually a distinct count or a percentile. ClickHouse has purpose-built approximate functions for exactly those cases, they work on *any* MergeTree table with no `SAMPLE BY` DDL requirement, and hypequery supports them natively.

[`quantile()`](/clickhouse/functions/quantile) is approximate by design (reservoir sampling under the hood), and it's a first-class builder method:

```ts
import { createQueryBuilder } from '@hypequery/clickhouse';
import type { IntrospectedSchema } from './generated/schema.js';

const db = createQueryBuilder<IntrospectedSchema>({
  url: process.env.CLICKHOUSE_URL!,
  username: process.env.CLICKHOUSE_USERNAME!,
  password: process.env.CLICKHOUSE_PASSWORD,
  database: process.env.CLICKHOUSE_DATABASE!,
});

const latency = await db
  .table('events')
  .select(['event_type'])
  .quantile('duration_ms', 0.95, 'p95_duration_ms')
  .where('created_at', 'gte', '2026-07-11 00:00:00')
  .groupBy('event_type')
  .execute();
```

For distinct counts, [`uniq()`](/clickhouse/functions/uniq) is the approximate family — fast, fixed memory, typically within a small percent of exact. Note the default gotcha: `.countDistinct()` emits `COUNT(DISTINCT ...)`, which ClickHouse maps to the exact-but-memory-heavy `uniqExact` unless you say otherwise. Two ways to get the approximate version:

```ts
import { selectExpr } from '@hypequery/clickhouse';

// Explicit: write uniq() as an expression
const approxUsers = await db
  .table('events')
  .select(['event_type', selectExpr('uniq(user_id)', 'unique_users')])
  .where('created_at', 'gte', '2026-07-11 00:00:00')
  .groupBy('event_type')
  .execute();

// Or keep .countDistinct() and flip the ClickHouse setting for this query
const approxUsersViaSetting = await db
  .table('events')
  .select(['event_type'])
  .countDistinct('user_id', 'unique_users')
  .settings({ count_distinct_implementation: 'uniq' })
  .where('created_at', 'gte', '2026-07-11 00:00:00')
  .groupBy('event_type')
  .execute();
```

The practical upside over `SAMPLE`: no DDL prerequisite, no manual result scaling, and the query stays fully typed in the builder. For a lot of prototyping — "roughly how many users hit this path last week?", "what's p95 latency by event type?" — approximate aggregates remove the need for `SAMPLE` entirely.

### Option 2: raw SQL with @clickhouse/client for genuine SAMPLE

If you need the real thing — you're profiling a complex query shape over a `SAMPLE BY` table, or the expensive part isn't the aggregation but the scan itself — drop to the official `@clickhouse/client` (which hypequery itself builds on) and write the SQL directly:

```ts
import { createClient } from '@clickhouse/client';

const client = createClient({
  url: process.env.CLICKHOUSE_URL!,
  username: process.env.CLICKHOUSE_USERNAME!,
  password: process.env.CLICKHOUSE_PASSWORD,
  database: process.env.CLICKHOUSE_DATABASE!,
});

const result = await client.query({
  query: `
    SELECT
      page_path,
      count() * any(_sample_factor) AS estimated_views,
      uniq(user_id) * any(_sample_factor) AS estimated_users
    FROM events
    SAMPLE 0.1
    WHERE created_at >= now() - INTERVAL 7 DAY
    GROUP BY page_path
    ORDER BY estimated_views DESC
    LIMIT 20
  `,
  format: 'JSONEachRow',
});

const rows = await result.json<{
  page_path: string;
  estimated_views: number;
  estimated_users: number;
}>();
```

You lose the generated types and compile-time checks for this one query, and you own the row-shape annotation by hand. That's the honest trade, and it's fine for prototyping — the point of `SAMPLE` is a throwaway iteration loop, not production plumbing. For a fuller picture of what the typed layer adds and when raw SQL is the right escape hatch, see [hypequery vs @clickhouse/client](/compare/hypequery-vs-clickhouse-client).

## A prototyping workflow that holds up

A loop that works well in practice:

1. **Explore with `SAMPLE`** (raw SQL, or just `clickhouse-client` in a terminal) while you're figuring out the query shape. Iterations on 10% of the data come back 5–10x faster, which changes how many ideas you actually try.
2. **Validate once without `SAMPLE`** — run the final shape at full scale and compare against a `SAMPLE 0.1 OFFSET 0.5` slice to confirm the estimates were stable.
3. **Productionize in the typed builder** — port the query to hypequery, swapping `SAMPLE`-plus-scaling for approximate aggregates where an estimate is acceptable, or exact aggregates where it isn't. Now the query is typed, parameterized, and safe to wire into an API.

The failure mode to avoid is shipping the `SAMPLE`-based raw SQL to production because it was lying around. Sampled numbers plus manual scaling factors are exactly the kind of thing that silently breaks when someone changes the fraction and not the multiplier.

## When SAMPLE isn't the right tool

- **The table has no `SAMPLE BY`.** Most tables don't, and rebuilding a large table to add one just for prototyping is rarely worth it. Use approximate aggregates or a `WHERE` clause on a shorter time range instead.
- **Your filter already does the work.** If a selective filter (tenant, recent time window) cuts the scan to a sliver, sampling on top saves little. Filter placement matters more — see [PREWHERE vs WHERE](/blog/clickhouse-prewhere-vs-where).
- **You need exact numbers.** Billing, invoicing, anything customer-facing where "roughly right" reads as "wrong."
- **The table is small.** Under tens of millions of rows, ClickHouse full scans are usually fast enough that sampling is pure complexity.

`SAMPLE` earns its keep in one specific situation: iterating on genuinely expensive scans over `SAMPLE BY` tables, where you control the trade between speed and precision per query. For everything else, approximate aggregates get you the speed without the DDL prerequisite or the scaling bookkeeping.

## Where to go from here

- [Quick start](/docs/quick-start) — generate types from your ClickHouse schema and run your first typed query.
- [uniq()](/clickhouse/functions/uniq) and [quantile()](/clickhouse/functions/quantile) — the approximate aggregate references.
- [hypequery vs @clickhouse/client](/compare/hypequery-vs-clickhouse-client) — what the typed layer adds, and when raw SQL is the right call.
- [ClickHouse and TypeScript](/clickhouse-typescript) — the broader guide to building a typed analytics backend.
