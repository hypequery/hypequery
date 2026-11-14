---
title: "ClickHouse PREWHERE vs WHERE: When PREWHERE Helps"
description: "PREWHERE filters before reading all columns, WHERE filters after. Learn when PREWHERE actually improves ClickHouse performance, when it does not matter, and how to approach it from a TypeScript app using hypequery."
seoTitle: "ClickHouse PREWHERE vs WHERE: When PREWHERE Helps"
seoDescription: "PREWHERE reads the filter columns first and skips non-matching rows. ClickHouse moves WHERE conditions to PREWHERE automatically; add it only when profiling helps."
pubDate: 2026-04-25
updatedAt: 2026-11-14
heroImage: ""
slug: clickhouse-prewhere-vs-where
status: published
---

PREWHERE is a ClickHouse-specific optimization that can reduce reads when a selective filter lets ClickHouse avoid loading expensive columns too early.

**Short answer:** use `PREWHERE` when a compact, selective filter can eliminate most rows before ClickHouse reads wide or expensive columns. Use normal `WHERE` when the filter is not selective, depends on computed values, or when ClickHouse already auto-promotes the condition for you.

If you are building with TypeScript, the shortest path is still to start with the typed hypequery builder for normal filters, then reach for explicit `PREWHERE` only when you have profiled a real query and know the extra control is worth it. If you want to start there, use the [quick start](/docs/quick-start) and then come back to `PREWHERE` as an optimization step rather than a default.

This post explains the mechanics, shows where `PREWHERE` helps most, and gives a practical rule for when to stay with `WHERE`. The settings and `EXPLAIN` output below were checked on ClickHouse 25.8.

## Quick answers

### What is PREWHERE in ClickHouse?

`PREWHERE` is a filter clause for MergeTree tables. ClickHouse reads the `PREWHERE` columns first, works out which rows match, and then reads the other columns only for the parts of the table that contain matching rows. It saves disk reads when the filter is selective and the other columns are large.

### What is the difference between PREWHERE and WHERE?

They return the same rows. The difference is the reading order: with `PREWHERE`, the filter columns are read and evaluated before the rest of the query's columns. With `WHERE` alone, ClickHouse would read every referenced column and then filter, except that it usually moves `WHERE` conditions to `PREWHERE` for you.

### Does ClickHouse use PREWHERE automatically?

Yes. `optimize_move_to_prewhere` is on by default and moves `WHERE` conditions to `PREWHERE` on MergeTree tables. On ClickHouse 25.8, `move_all_conditions_to_prewhere` is also on by default, so in our test both `tenant_id = 42` and `toDate(created_at) = today()` were moved. Check with `EXPLAIN actions = 1` and look for `Prewhere info`.

### Does PREWHERE work on every table engine?

No. It works on the MergeTree family. On a `Memory` table, ClickHouse 25.8 rejects it with `ILLEGAL_PREWHERE` ("does not support PREWHERE").

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
3. Read the remaining columns, **but only for the granules (blocks of rows) that contain matching rows**
4. Apply any WHERE filter on top
5. Continue processing

The IO saving is real when PREWHERE eliminates most rows before expensive columns are read. If matching rows sit in about 10% of the granules, ClickHouse reads the other columns for about 10% of the table instead of all of it. If matching rows are spread across every granule, there is little to skip.

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

// Ordinary filters stay in WHERE
const withWhere = await db
  .table('events')
  .select(['event_type'])
  .where('tenant_id', 'eq', tenantId)
  .where('created_at', 'gte', dayStart)
  .count('event_type', 'cnt')
  .groupBy('event_type')
  .execute();

// Move the selective tenant condition into ClickHouse PREWHERE
const withPrewhere = await db
  .table('events')
  .select(['event_type'])
  .prewhere('tenant_id', 'eq', tenantId)
  .where('created_at', 'gte', dayStart)
  .count('event_type', 'cnt')
  .groupBy('event_type')
  .execute();
```

`prewhere()` uses the same typed column and operator checks as `where()`. Reach for it after profiling shows that reading a compact, selective column first will reduce IO; otherwise, `where()` is usually the clearer default.

## When PREWHERE Helps Most

PREWHERE delivers the biggest gains when all of these are true:

**The filter column is compact.** `UInt32`, `UInt8`, `LowCardinality(String)` — columns that are cheap to read. If the PREWHERE column is itself large, you're not saving much IO.

**The filter is selective.** A condition that eliminates 80–99% of rows before reading other columns is where the win comes from. Filtering on `tenant_id` in a multi-tenant system is the canonical case.

**The remaining columns are expensive.** If all your columns are small integers, PREWHERE doesn't help much because there's not much IO to avoid. The payoff is when you have wide rows with large string or JSON columns.

**MergeTree tables.** PREWHERE is only available on MergeTree family engines (MergeTree, ReplacingMergeTree, AggregatingMergeTree, etc.). On other engines such as `Memory`, ClickHouse returns an `ILLEGAL_PREWHERE` error.

## When WHERE Is Enough

Use `WHERE` instead of explicit `PREWHERE` when:

- **Filtering on computed values**: `WHERE toDate(created_at) = today()` still has to read `created_at`. ClickHouse 25.8 moves it to PREWHERE automatically anyway, so there is no reason to write that by hand.
- **Multiple columns together**: conditions like `WHERE a = 1 AND b = 2` where both columns need to be read together. You could PREWHERE on the most selective one and WHERE on the rest.
- **Nullable columns**: PREWHERE has edge cases with NULL handling in some ClickHouse versions — using WHERE is safer.
- **The filter column is in the sort key and ClickHouse can skip granules**: ClickHouse's primary index already skips the granules that can't match, so there is less left for PREWHERE to save.

## Let ClickHouse Auto-Promote First

ClickHouse moves WHERE conditions to PREWHERE automatically on MergeTree tables (`optimize_move_to_prewhere`, on by default). On ClickHouse 25.8, `move_all_conditions_to_prewhere` is also on by default, so every condition that can move does. Plain `EXPLAIN` doesn't show this; use `EXPLAIN actions = 1`:

```sql
EXPLAIN actions = 1
SELECT event_type, count()
FROM events
WHERE tenant_id = 42 AND toDate(created_at) = today()
GROUP BY event_type;
```

On ClickHouse 25.8 the output includes a `Prewhere info` block whose `Prewhere filter column` holds both conditions. If ClickHouse already promotes the condition, there may be no reason to add explicit raw SQL for PREWHERE in your application layer at all.

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
