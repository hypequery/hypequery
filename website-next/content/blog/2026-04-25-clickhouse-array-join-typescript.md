---
title: "How to Use ARRAY JOIN in ClickHouse with TypeScript"
description: "ARRAY JOIN flattens array columns into individual rows. Here's how it works, when to use it, and how to write it in TypeScript with hypequery."
seoTitle: "ClickHouse ARRAY JOIN TypeScript — Flatten Array Columns"
seoDescription: "ARRAY JOIN in ClickHouse flattens array columns into rows. Learn how to use it in TypeScript with hypequery for tag explosion, event properties, and nested data."
pubDate: 2026-04-25
heroImage: ""
slug: clickhouse-array-join-typescript
status: published
---

ClickHouse has native support for `Array(T)` columns — you can store an array of strings, integers, or other values in a single column. ARRAY JOIN is the mechanism for turning those arrays into rows, which is what you need when you want to aggregate or filter on individual array elements.

## What ARRAY JOIN Does

Given a table with an array column:

```
| event_id | user_id | tags                          |
|----------|---------|-------------------------------|
| 1        | u1      | ['react', 'typescript', 'web']|
| 2        | u2      | ['python', 'data']            |
| 3        | u3      | []                            |
```

`ARRAY JOIN tags` explodes each row into one row per array element:

```
| event_id | user_id | tags       |
|----------|---------|------------|
| 1        | u1      | react      |
| 1        | u1      | typescript |
| 1        | u1      | web        |
| 2        | u2      | python     |
| 2        | u2      | data       |
```

Row 3 (empty array) disappears — regular `ARRAY JOIN` excludes rows with empty arrays. `LEFT ARRAY JOIN` keeps them, producing one row with `tags = ''` (the default empty value for the element type).

## Schema Example

```sql
CREATE TABLE events (
  id String,
  user_id String,
  event_type String,
  tags Array(String),
  created_at DateTime
) ENGINE = MergeTree()
ORDER BY (created_at, id);
```

Generate the TypeScript schema:

```bash
npx @hypequery/cli generate --output ./schema.ts
```

The generated type will represent `tags` as `string[]` in TypeScript — an array of strings, matching the `Array(String)` column type.

## Using ARRAY JOIN from a hypequery-based TypeScript app

```typescript
import { createQueryBuilder } from '@hypequery/clickhouse';
import type { Schema } from './schema';

const db = createQueryBuilder<Schema>({ url: 'http://localhost:8123' });

const tagCounts = await db
  .table('events')
  .arrayJoin('tags')
  .select(['tags'])
  .where('created_at', 'gte', '2026-04-18 00:00:00')
  .count('tags', 'event_count')
  .groupBy('tags')
  .orderBy('event_count', 'DESC')
  .limit(20)
  .execute();
```

`arrayJoin()` only accepts array-typed columns from the generated schema, so a scalar column is rejected at compile time. At runtime, ClickHouse returns one row per array element.

## LEFT ARRAY JOIN — Keep Rows With Empty Arrays

Regular ARRAY JOIN drops rows where the array is empty. Use `LEFT ARRAY JOIN` when you need to preserve those rows:

```typescript
const allEvents = await db
  .table('events')
  .leftArrayJoin('tags')
  .select(['id', 'user_id', 'tags'])
  .where('created_at', 'gte', dayStart)
  .execute();
```

`LEFT ARRAY JOIN` is analogous to a LEFT JOIN in standard SQL — you get at least one row per source row, even when the array is empty.

## Practical Use Case: Tag Analytics

Here's a complete example — find the top tags used in events this month, with the count of unique users who used each tag:

```typescript
async function getTopTags(month: string) {
  return db
    .table('events')
    .arrayJoin('tags')
    .select(['tags'])
    .where('created_at', 'gte', \`${month}-01 00:00:00\`)
    .count('tags', 'uses')
    .countDistinct('user_id', 'unique_users')
    .groupBy('tags')
    .orderBy('uses', 'DESC')
    .limit(10)
    .execute();
}

const topTags = await getTopTags('2026-04');
// [{ tags: 'react', uses: '1842', unique_users: '312' }, ...]
```

## Joining with Index

ClickHouse also supports array index access when you ARRAY JOIN — this is useful when you have parallel arrays where position matters:

```sql
-- ClickHouse SQL
SELECT event_id, tag, tag_weight
FROM events
ARRAY JOIN tags, tag_weights
```

This joins `tags` and `tag_weights` in parallel (both arrays must have the same length). For several arrays in the same clause, use a focused raw expression; the fluent `arrayJoin()` helper covers the common one-column case.

## Event Properties Pattern

A common pattern in event tracking is to store event property keys and values as parallel arrays rather than nested objects (ClickHouse handles parallel arrays more efficiently than JSON parsing at scale):

```sql
CREATE TABLE events (
  id String,
  user_id String,
  event_type String,
  prop_keys Array(String),
  prop_values Array(String),
  created_at DateTime
) ENGINE = MergeTree()
ORDER BY (created_at, id);
```

```typescript
// Find all events where any property has a specific value
const results = await db.rawQuery<{
  id: string;
  user_id: string;
  event_type: string;
  prop_key: string;
  prop_value: string;
}>(
  \`SELECT id, user_id, event_type, prop_keys AS prop_key, prop_values AS prop_value
   FROM events
   ARRAY JOIN prop_keys, prop_values
   WHERE prop_keys = ?
     AND prop_values = ?
     AND toDate(created_at) = ?\`,
  ['plan', 'enterprise', today],
);
```

## Type Implications

The key runtime behaviour to remember: after ARRAY JOIN, ClickHouse returns the exploded column's element value on each row. The builder validates that the source column is an array; use an aliased `selectExpr()` when you also want to state a transformed result type explicitly.
