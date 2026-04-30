---
title: "ClickHouse PREWHERE vs WHERE: When PREWHERE Helps"
description: "PREWHERE filters before reading all columns, WHERE filters after. Learn when PREWHERE actually improves ClickHouse performance, when it does not matter, and how to approach it from a TypeScript app using hypequery."
seoTitle: "ClickHouse PREWHERE vs WHERE: When PREWHERE Helps"
seoDescription: "PREWHERE in ClickHouse can reduce reads and improve query performance. Learn when to use PREWHERE vs WHERE, with practical examples and TypeScript context."
pubDate: 2026-04-25
heroImage: ""
slug: clickhouse-prewhere-vs-where
status: published
---

PREWHERE is a ClickHouse-specific optimization that can reduce reads when a selective filter lets ClickHouse avoid loading expensive columns too early.

**Short answer:** use `PREWHERE` when a compact, selective filter can eliminate most rows before ClickHouse reads wide or expensive columns. Use normal `WHERE` when the filter is not selective, depends on computed values, or when ClickHouse already auto-promotes the condition for you.

If you are building with TypeScript, the shortest path is still to start with the typed hypequery builder for normal filters, then reach for explicit `PREWHERE` only when you have profiled a real query and know the extra control is worth it. If you want to start there, use the [quick start](/docs/quick-start) and then come back to `PREWHERE` as an optimization step rather than a default.

This post explains the mechanics, shows where `PREWHERE` helps most, and gives a practical rule for when to stay with `WHERE`.

## How Columnar Storage Works (Briefly)

ClickHouse stores data by column, not by row. When you run a query, ClickHouse reads only the columns you reference — not the entire row. This is what makes it fast for analytics: a query on a 100-column table that only touches 3 columns reads roughly 3% of the data a row-oriented database would read.

## What PREWHERE Does

Standard WHERE:
1. Read all columns referenced anywhere in the query (SELECT + WHERE + GROUP BY)
2. Apply the WHERE filter
3. Discard non-matching rows
4. Continue processing

PREWHERE:
1. Read only the PREWHERE column(s)
2. Apply the PREWHERE filter — identify which rows pass
3. Read the remaining columns, **but only for the rows that passed**
4. Apply any WHERE filter on top
5. Continue processing

The IO saving is real when PREWHERE eliminates most rows before expensive columns are read. If your PREWHERE condition filters out 90% of rows, you read the remaining 90% of column data at 10% of the cost.

## When PREWHERE Helps

Use `PREWHERE` when all of these are roughly true:

- The filter column is cheap to read, such as `UInt32`, `UInt8`, or `LowCardinality(String)`
- The filter is selective enough to remove most rows early
- The other referenced columns are relatively expensive, wide, or string-heavy
- The table is in the `MergeTree` family

If those conditions are not true, `WHERE` is usually enough and often clearer.

## A Concrete Example

Consider this events table for a multi-tenant SaaS:

```sql
CREATE TABLE events (
  tenant_id UInt32,
  user_id String,
  event_type String,
  page_path String,
  properties JSON,     -- large column
  raw_payload String,  -- large column
  created_at DateTime
) ENGINE = MergeTree()
ORDER BY (tenant_id, created_at);
```

A typical query filters by `tenant_id` first, which is the first column in the sort key:

```typescript
import { createQueryBuilder } from '@hypequery/clickhouse';
import type { Schema } from './schema';

const db = createQueryBuilder<Schema>({ host: 'http://localhost:8123' });

// Using the typed builder — straightforward and safe for most app queries
const withWhere = await db
  .table('events')
  .select('event_type', 'count() as cnt')
  .where('tenant_id', 'eq', tenantId)
  .where('toDate(created_at)', 'eq', today)
  .groupBy('event_type')
  .execute();

// If you need an explicit PREWHERE clause today, use raw SQL intentionally
const withPrewhere = await db.rawQuery(
  \`SELECT event_type, count() AS cnt
   FROM events
   PREWHERE tenant_id = ?
   WHERE toDate(created_at) = ?
   GROUP BY event_type\`,
  [tenantId, today],
);
```

The important point for hypequery users is that PREWHERE is a ClickHouse SQL optimisation, not currently a dedicated builder method in this repo. Use the typed builder for ordinary filters, and reach for raw SQL when you have profiled a query and know explicit PREWHERE is worth the extra control.

## When PREWHERE Helps Most

PREWHERE delivers the biggest gains when all of these are true:

**The filter column is compact.** `UInt32`, `UInt8`, `LowCardinality(String)` — columns that are cheap to read. If the PREWHERE column is itself large, you're not saving much IO.

**The filter is selective.** A condition that eliminates 80–99% of rows before reading other columns is where the win comes from. Filtering on `tenant_id` in a multi-tenant system is the canonical case.

**The remaining columns are expensive.** If all your columns are small integers, PREWHERE doesn't help much because there's not much IO to avoid. The payoff is when you have wide rows with large string or JSON columns.

**MergeTree tables.** PREWHERE is only available on MergeTree family engines (MergeTree, ReplacingMergeTree, AggregatingMergeTree, etc.). It's silently ignored or errors on other engines.

## When WHERE Is Enough

Use `WHERE` instead of explicit `PREWHERE` when:

- **Filtering on computed values**: `WHERE toDate(created_at) = today` — this requires reading `created_at` regardless, so PREWHERE on a computed value doesn't help.
- **Multiple columns together**: conditions like `WHERE a = 1 AND b = 2` where both columns need to be read together. You could PREWHERE on the most selective one and WHERE on the rest.
- **Nullable columns**: PREWHERE has edge cases with NULL handling in some ClickHouse versions — using WHERE is safer.
- **The filter column is in the sort key and ClickHouse can skip granules**: ClickHouse's primary key skip index already handles the IO reduction in this case.

## Let ClickHouse Auto-Promote First

Recent versions of ClickHouse (22.x+) automatically move some WHERE conditions to PREWHERE when it determines the optimisation is safe. You can check with `EXPLAIN` whether your WHERE was promoted:

```sql
EXPLAIN SELECT event_type, count()
FROM events
WHERE tenant_id = 42 AND toDate(created_at) = today()
GROUP BY event_type;
```

Look for `Prewhere info` in the output. If ClickHouse already promotes the condition, there may be no reason to add explicit raw SQL for PREWHERE in your application layer at all.

## Combining PREWHERE and WHERE

You can use both in the same SQL query:

```sql
SELECT page_path, count() AS views
FROM events
PREWHERE tenant_id = 42
WHERE event_type = 'page_view'
  AND toDate(created_at) = today()
GROUP BY page_path
ORDER BY views DESC
LIMIT 10
```

PREWHERE runs first to narrow down to this tenant's rows. WHERE then applies the remaining conditions on that reduced set. In a hypequery app, that usually means one of two paths: keep the query in the typed builder and let ClickHouse auto-promote WHERE when appropriate, or switch to a raw SQL query when you need explicit PREWHERE control.

## Practical Rule For TypeScript Teams

The default workflow should be:

1. Start with the typed builder and normal `WHERE`
2. Measure the real query
3. Check whether ClickHouse already auto-promotes the condition
4. Only switch to explicit `PREWHERE` with raw SQL when the gain is real

That keeps the day-one code path simple while still leaving room for ClickHouse-specific optimization when it actually matters.

If you want the shortest path to a typed baseline before worrying about `PREWHERE`, start with the [ClickHouse TypeScript guide](/clickhouse-typescript) or the [quick start](/docs/quick-start).
