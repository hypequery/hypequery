---
title: "FINAL vs ReplacingMergeTree Dedup in TypeScript Queries"
description: "ReplacingMergeTree deduplicates at merge time, so queries can see duplicates until merges run. Learn when the FINAL keyword is the right fix, what it costs, and when the argMax or LIMIT BY patterns are better — with typed TypeScript examples."
seoTitle: "ClickHouse FINAL Keyword: ReplacingMergeTree Dedup Explained"
seoDescription: "The ClickHouse FINAL keyword forces ReplacingMergeTree deduplication at query time, at a performance cost. When FINAL is fine, when to use argMax or LIMIT BY instead, and how to write all three in TypeScript."
pubDate: 2026-07-18
heroImage: ""
slug: clickhouse-final-replacingmergetree-typescript
status: published
tags:
  - ClickHouse
  - TypeScript
---

If you came to ClickHouse from Postgres or MySQL, `ReplacingMergeTree` looks like upsert support: insert a new version of a row, the old one goes away. Then you query the table and both versions come back. That is not a bug.

**Short answer:** `ReplacingMergeTree` deduplicates during background merges, which happen *eventually* and on ClickHouse's schedule, not on insert. Until a merge runs, queries see every version of every row. Adding the `FINAL` keyword to a query forces merge semantics at read time, so you always get the deduplicated result, but you pay for that merge work on every query. For hot paths, the `argMax(col, version) ... GROUP BY key` pattern or `LIMIT 1 BY key` is usually the better trade. hypequery supports all three natively: `.final()`, `.argMax()`, and `.limitBy()`.

This post shows the failure mode, the three fixes in SQL and in typed TypeScript, and a practical rule for choosing between them. If you want the typed setup first, the [quick start](/docs/quick-start) gets you from a live ClickHouse schema to a generated [query builder](/clickhouse-query-builder) in a few minutes.

## Why You See Duplicates

Here is a typical orders table for a SaaS backend, where order status changes over time and each change is inserted as a new row:

```sql
CREATE TABLE orders (
  order_id String,
  tenant_id UInt32,
  status LowCardinality(String),
  total Float64,
  updated_at DateTime
)
ENGINE = ReplacingMergeTree(updated_at)
ORDER BY (tenant_id, order_id);
```

Two things matter in that DDL:

- The **dedup key is the `ORDER BY` key** — `(tenant_id, order_id)`. Rows with the same sort key are candidates for replacement.
- `updated_at` is the **version column**. When ClickHouse collapses duplicates, it keeps the row with the highest version. Without a version column, it keeps whichever row happens to be last in the merged part, which is effectively "last insert wins, approximately".

Now the gotcha:

```sql
INSERT INTO orders VALUES ('ord_1001', 42, 'pending', 99.50, '2026-07-18 09:00:00');
-- payment settles a minute later; the backend inserts a new version
INSERT INTO orders VALUES ('ord_1001', 42, 'completed', 99.50, '2026-07-18 09:01:00');

SELECT count() FROM orders WHERE tenant_id = 42 AND order_id = 'ord_1001';
-- 2
```

Each insert lands in its own data part. Deduplication only happens when a background merge combines those parts, and ClickHouse gives **no guarantee about when** that happens. Minutes, hours, or never for old cold parts. Merges also only run within a partition, so duplicates that land in different partitions are never collapsed at all.

The practical consequence: `sum(total)` double-counts, `count()` overcounts, and a "current status" query can return a stale row next to the fresh one. Every query against a `ReplacingMergeTree` table has to state how it wants duplicates handled. You have three good options.

## Option 1: FINAL — Correct Now, Paid For Now

The `FINAL` keyword tells ClickHouse to apply merge semantics while reading:

```sql
SELECT order_id, status, total
FROM orders FINAL
WHERE tenant_id = 42;
```

You get exactly what the table would contain after all pending merges completed. In hypequery this is a native builder method, so the typed query stays typed:

```ts
import { createQueryBuilder } from '@hypequery/clickhouse';
import type { IntrospectedSchema } from './generated/schema.js';

const db = createQueryBuilder<IntrospectedSchema>({
  url: process.env.CLICKHOUSE_URL!,
  username: process.env.CLICKHOUSE_USERNAME!,
  password: process.env.CLICKHOUSE_PASSWORD,
  database: process.env.CLICKHOUSE_DATABASE!,
});

const orders = await db
  .table('orders')
  .select(['order_id', 'status', 'total'])
  .final()
  .where('tenant_id', 'eq', 42)
  .execute();
```

Aggregates work the same way — this revenue number does not double-count superseded versions:

```ts
const [row] = await db
  .table('orders')
  .final()
  .where('tenant_id', 'eq', 42)
  .where('status', 'eq', 'completed')
  .sum('total', 'revenue')
  .execute();
```

### What FINAL costs

`FINAL` is not free. To dedup at read time, ClickHouse has to look at all parts that might contain a given sort key, merge-sort them, and collapse duplicates before the rest of the query runs. That means extra CPU, extra memory, and less freedom to parallelize the read. Recent ClickHouse releases have improved `FINAL` substantially (parallel processing of non-overlapping ranges, skipping parts that are already fully merged), so old advice like "never use FINAL" is outdated — but it is still meaningfully slower than a plain read on large tables, and the gap grows with the number of unmerged parts.

One setting worth knowing: if your partitioning scheme guarantees that all versions of a row land in the same partition (for example, partitioning by tenant, not by event date), you can tell ClickHouse not to merge across partitions:

```ts
const current = await db
  .table('orders')
  .select(['order_id', 'status'])
  .final()
  .where('tenant_id', 'eq', 42)
  .settings({ do_not_merge_across_partitions_select_final: 1 })
  .execute();
```

That is safe for the table above because it has no `PARTITION BY` clause, so every version of an order lives in the same partition anyway. It is wrong if the same sort key can appear in multiple partitions — say, a table partitioned by month where a row's versions straddle a month boundary — so treat it as an opt-in optimization, not a default.

## Option 2: The argMax Pattern

The classic alternative is to dedup explicitly with an aggregation: for each key, take each column's value *at the maximum version*.

```sql
SELECT
  order_id,
  argMax(status, updated_at) AS status,
  argMax(total, updated_at) AS total
FROM orders
WHERE tenant_id = 42
GROUP BY order_id;
```

This is a plain `GROUP BY`, so ClickHouse can run it with its normal, highly parallel aggregation machinery instead of the merge-at-read path. hypequery has `argMax` as a first-class aggregation:

```ts
const latest = await db
  .table('orders')
  .select(['order_id'])
  .argMax('status', 'updated_at', 'status')
  .argMax('total', 'updated_at', 'total')
  .where('tenant_id', 'eq', 42)
  .groupBy('order_id')
  .execute();
```

Two caveats worth stating plainly:

- **You enumerate columns.** Every column you need becomes an `argMax` call. For wide tables that gets verbose, and adding a column to the table means updating every dedup query that needs it.
- **Version ties can mix rows.** Each `argMax` picks its value independently. If two versions of a row share the exact same `updated_at`, `status` could come from one row and `total` from the other. With a strictly increasing version column this never happens; with second-granularity timestamps it can.

For aggregates on top of the deduped state, wrap the pattern in a subquery:

```sql
SELECT sum(total) AS revenue
FROM (
  SELECT order_id, argMax(total, updated_at) AS total
  FROM orders
  WHERE tenant_id = 42 AND order_id != ''
  GROUP BY order_id
);
```

In hypequery you can build the inner query with the builder and attach it as a CTE with `.withCTE(alias, builder)`, but if this two-level shape is on a hot dashboard path, the better answer is usually to stop deduplicating at query time entirely and maintain the current state with a materialized view — see [the guide to materialized views in ClickHouse](/blog/a-guide-to-materialized-views-in-clickhouse).

## Option 3: LIMIT BY

ClickHouse has a third tool that most people coming from Postgres have never seen: `LIMIT n BY column`, which keeps the first `n` rows per group after sorting. Sort by version descending, keep one row per key:

```sql
SELECT order_id, status, total, updated_at
FROM orders
WHERE tenant_id = 42
ORDER BY updated_at DESC
LIMIT 1 BY order_id;
```

Unlike `argMax`, this keeps **whole physical rows**, so there is no risk of mixing columns from different versions, and you do not repeat an aggregate call per column. hypequery supports it natively:

```ts
const currentOrders = await db
  .table('orders')
  .select(['order_id', 'status', 'total', 'updated_at'])
  .where('tenant_id', 'eq', 42)
  .orderBy('updated_at', 'DESC')
  .limitBy(1, 'order_id')
  .execute();
```

The cost profile sits between the other two options: no merge-at-read, but the sort has to happen before rows are dropped. It shines for "latest N versions per key" queries, which `argMax` cannot express at all. There is a full write-up of the clause in [LIMIT BY in TypeScript](/blog/clickhouse-limit-by-typescript).

## Choosing: When FINAL Is Fine

A decision rule that holds up in practice:

**Use `.final()` when:**

- The table is small — dimension-style entity tables in the thousands to low millions of rows. The merge-at-read overhead is measured in milliseconds and the query stays trivially readable.
- The query is low-QPS: internal admin screens, support tooling, ad hoc debugging, nightly jobs. Paying 2–5x on a query that runs forty times a day is a great trade for code you never have to think about.
- Correctness is the whole point — billing reconciliation, audit views — and you would rather eat latency than reason about tie-breaking semantics.

**Use `argMax` or `LIMIT BY` when:**

- The query sits on a user-facing, high-QPS path: embedded dashboards, public APIs, anything where p95 latency is a product feature.
- The table is a large fact table with a steady insert stream, which means there are always fresh unmerged parts for `FINAL` to chew through.
- You need "latest state per key" as an intermediate step inside a bigger aggregation, where the `GROUP BY` formulation composes better.

**Use neither when the query is hot enough to precompute.** If a deduped aggregate is queried constantly, materialize the current state or the aggregate itself with a materialized view and query that instead. Query-time dedup is a tax; sometimes the right move is to stop paying it.

And whichever you choose: benchmark on your own data and ClickHouse version. `FINAL` performance has moved a lot in recent releases, and the folklore about it is older than the improvements.

## One Habit That Prevents Incidents

Never write a query against a `ReplacingMergeTree` table that silently assumes merges have happened. It will pass in dev, where your ten test rows merged minutes ago, and produce double-counted revenue in production during an insert-heavy hour. Resist the temptation to "fix" it with scheduled `OPTIMIZE TABLE ... FINAL` — that forces a full rewrite of the table's parts and is far more expensive than either query-time option used well.

The nice thing about having `.final()`, `.argMax()`, and `.limitBy()` as first-class typed methods is that the dedup decision is visible in code review. A query on a replacing table with none of the three is a red flag you can catch before it ships — the same way [type-safe filters](/clickhouse-typescript) catch a mistyped column before runtime.

## Where to go from here

- [LIMIT BY in TypeScript](/blog/clickhouse-limit-by-typescript) — the full guide to top-N-per-group queries, including pagination interactions.
- [A guide to materialized views in ClickHouse](/blog/a-guide-to-materialized-views-in-clickhouse) — precompute deduped state instead of paying at query time.
- [ClickHouse for real-time analytics](/clickhouse-real-time-analytics) — where merge-time semantics fit in a streaming ingest architecture.
- [Quick start](/docs/quick-start) — generate types from your schema and run your first typed query in about five minutes.
