---
title: "ClickHouse JOIN Types in TypeScript — LEFT, RIGHT, INNER, and ARRAY JOIN"
description: "How ClickHouse handles RIGHT JOIN, LEFT JOIN, INNER JOIN, and ARRAY JOIN — with performance notes and TypeScript examples using hypequery."
seoTitle: "ClickHouse RIGHT JOIN, LEFT JOIN, INNER JOIN — TypeScript Guide"
seoDescription: "How ClickHouse handles RIGHT JOIN, LEFT JOIN, INNER JOIN, and ARRAY JOIN — with performance notes and TypeScript examples using hypequery."
pubDate: 2026-04-25
heroImage: ""
slug: clickhouse-joins-typescript
status: published
---

ClickHouse supports the full set of SQL JOIN types — INNER, LEFT OUTER, RIGHT OUTER, FULL OUTER, CROSS — plus its own ARRAY JOIN which is a different concept entirely. The syntax looks familiar but the execution model is not like Postgres. Understanding how ClickHouse handles JOINs changes which ones you reach for.

## How ClickHouse Executes JOINs

The important difference: **ClickHouse loads the right-side table into memory in a hash table**. The left side is streamed; the right side must fit in memory. This means:

- Keep the smaller table on the right
- For large right-side tables, memory becomes the constraint, not IO
- ClickHouse is not optimised for JOINs the way a row-oriented OLTP database is — its strengths are aggregations over many rows in a single table, not multi-table relational queries

For production analytics workloads where JOINs are frequent or the joined tables are large, the standard alternatives are [Dictionaries](https://clickhouse.com/docs/en/sql-reference/dictionaries) (for lookup tables), [materialized views](/blog/clickhouse-materialized-views-typescript) that pre-join data at write time, or just denormalizing into a single wide table.

With that said — JOINs work, and for moderate data sizes they're fine.

## INNER JOIN

Both sides must have a matching row. Rows without a match on either side are excluded.

```sql
SELECT
  o.order_id,
  o.amount,
  u.name AS user_name
FROM orders o
INNER JOIN users u ON o.user_id = u.id
WHERE o.created_at >= '2026-01-01'
```

Use INNER JOIN when you need strict referential integrity in the result — only rows where the join condition is satisfied on both sides. In analytics, this often means "orders placed by known users" with orphaned orders excluded.

## LEFT JOIN

All rows from the left table, with matching rows from the right. If there's no match on the right, the right-side columns come back as NULL (or default values for non-nullable types in ClickHouse).

```sql
SELECT
  e.event_type,
  e.created_at,
  u.name AS user_name,
  u.plan AS user_plan
FROM events e
LEFT JOIN users u ON e.user_id = u.id
WHERE e.tenant_id = 42
  AND e.created_at >= '2026-04-01'
```

LEFT JOIN is the most common JOIN in analytics: get all events, optionally enriched with user metadata where available. Anonymous events or events with no matching user record still appear in results.

## RIGHT JOIN

All rows from the right table, with matching rows from the left. This is the mirror of LEFT JOIN.

```sql
SELECT
  o.order_id,
  o.amount,
  u.id AS user_id,
  u.name
FROM orders o
RIGHT JOIN users u ON o.user_id = u.id
```

In practice, **you almost never need RIGHT JOIN** — you can always rewrite it as a LEFT JOIN by swapping the tables:

```sql
-- Equivalent to the RIGHT JOIN above
SELECT
  o.order_id,
  o.amount,
  u.id AS user_id,
  u.name
FROM users u
LEFT JOIN orders o ON o.user_id = u.id
```

The LEFT JOIN version is preferred because it's more readable (the "primary" table is first) and because it keeps the larger table on the left where ClickHouse streams it rather than loading it into memory.

## FULL OUTER JOIN

All rows from both tables. Rows without a match on either side are included with NULLs on the missing side.

```sql
SELECT
  a.user_id AS user_a,
  b.user_id AS user_b
FROM cohort_a a
FULL OUTER JOIN cohort_b b ON a.user_id = b.user_id
```

Useful for set comparisons — finding users in either cohort, or users that appear in one but not the other.

## ARRAY JOIN — Not a Relational Join

ARRAY JOIN is a ClickHouse-specific feature that is **fundamentally different from relational joins**. It's not joining two tables — it flattens an array column into multiple rows, one row per array element.

```sql
-- Table: page_views with a 'tags' Array(String) column
SELECT
  page_path,
  tag
FROM page_views
ARRAY JOIN tags AS tag
WHERE tenant_id = 42
```

If a `page_views` row has `tags = ['analytics', 'dashboard', 'beta']`, ARRAY JOIN produces three output rows from that one input row, each with a different `tag` value. This is used for event properties stored as arrays, multi-value attributes, and similar denormalized structures common in ClickHouse schemas.

See [ClickHouse ARRAY JOIN in TypeScript](/blog/clickhouse-array-join-typescript) for a full treatment of this pattern.

## JOINs in TypeScript with hypequery

hypequery is focused on typed query composition, but for more complex JOIN shapes it is reasonable to use raw SQL:

```typescript
import { createQueryBuilder } from '@hypequery/clickhouse';
import type { Schema } from './schema';

const db = createQueryBuilder<Schema>({ host: 'http://localhost:8123' });

// Raw SQL for a JOIN query
const result = await db.rawQuery<{
  order_id: string;
  amount: string;
  user_name: string;
}>(
  `SELECT
    o.order_id,
    toString(o.amount) AS amount,
    u.name AS user_name
  FROM orders o
  LEFT JOIN users u ON o.user_id = u.id
  WHERE o.tenant_id = ?
    AND o.created_at >= ?`,
  [tenantId, fromDate],
);
```

The raw escape hatch gives you full SQL control with parameterized queries. The type parameter tells TypeScript what the result rows look like.

For single-table queries — which cover the majority of ClickHouse analytics workloads — hypequery's typed query builder handles the common path well: `WHERE`, `GROUP BY`, `ORDER BY`, aggregations, and time-series bucketing. When a query needs ClickHouse-specific join or `PREWHERE` syntax, use raw SQL directly.

## Performance Summary

| Join Type | When to Use | Watch Out For |
|-----------|-------------|---------------|
| INNER JOIN | Both sides must match | Excludes non-matching rows silently |
| LEFT JOIN | All left rows, optional right match | Right side loaded into memory |
| RIGHT JOIN | Rarely — rewrite as LEFT JOIN | Less readable, same memory constraint |
| FULL OUTER JOIN | Set union/difference queries | Both sides must fit in memory |
| ARRAY JOIN | Flattening array columns | Not a table join — different concept |

For large-scale production use, consider Dictionaries for dimension lookups and denormalized schemas to avoid JOINs in hot query paths.

---

Related: [ClickHouse Query Builder](/clickhouse-query-builder) · [ClickHouse TypeScript Guide](/clickhouse-typescript) · [ClickHouse ARRAY JOIN in TypeScript](/blog/clickhouse-array-join-typescript)
