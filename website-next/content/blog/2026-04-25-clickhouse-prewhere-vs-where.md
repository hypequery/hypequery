---
title: "ClickHouse PREWHERE vs WHERE — When to Use Each"
description: "PREWHERE filters before reading all columns, WHERE filters after. Here's when the difference matters and how to think about PREWHERE from a TypeScript app using hypequery."
seoTitle: "ClickHouse PREWHERE vs WHERE Explained — Performance and Usage"
seoDescription: "PREWHERE in ClickHouse filters before reading all columns — WHERE filters after. Learn when PREWHERE improves performance and how to approach it from a TypeScript app using hypequery."
pubDate: 2026-04-25
heroImage: ""
slug: clickhouse-prewhere-vs-where
status: published
---

PREWHERE is a ClickHouse-specific optimisation that doesn't exist in standard SQL. It's not magic — it solves a specific problem in columnar storage — but when applied to the right queries it can meaningfully reduce IO and improve query speed. This post explains the mechanics and shows when to reach for it.

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

## When to Use WHERE Instead

Use WHERE (not PREWHERE) when:

- **Filtering on computed values**: `WHERE toDate(created_at) = today` — this requires reading `created_at` regardless, so PREWHERE on a computed value doesn't help.
- **Multiple columns together**: conditions like `WHERE a = 1 AND b = 2` where both columns need to be read together. You could PREWHERE on the most selective one and WHERE on the rest.
- **Nullable columns**: PREWHERE has edge cases with NULL handling in some ClickHouse versions — using WHERE is safer.
- **The filter column is in the sort key and ClickHouse can skip granules**: ClickHouse's primary key skip index already handles the IO reduction in this case.

## Note on Auto-Optimization

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
