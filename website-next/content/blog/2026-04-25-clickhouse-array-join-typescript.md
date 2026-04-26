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

const db = createQueryBuilder<Schema>({ host: 'http://localhost:8123' });

// ARRAY JOIN is currently a raw SQL escape-hatch use case
const tagCounts = await db.rawQuery<{ tags: string; event_count: string }>(
  \`SELECT tags, count() AS event_count
   FROM events
   ARRAY JOIN tags
   WHERE created_at >= ?
   GROUP BY tags
   ORDER BY event_count DESC
   LIMIT 20\`,
  ['2026-04-18 00:00:00'],
);

// tagCounts[0].tags is string, not string[]
```

After ARRAY JOIN, the `tags` column changes from `string[]` (the array) to `string` (a single element). Because ARRAY JOIN is not currently wrapped as a dedicated builder helper here, you should annotate the rawQuery result shape explicitly.

## LEFT ARRAY JOIN — Keep Rows With Empty Arrays

Regular ARRAY JOIN drops rows where the array is empty. Use `LEFT ARRAY JOIN` when you need to preserve those rows:

```typescript
const allEvents = await db.rawQuery<{ id: string; user_id: string; tags: string }>(
  \`SELECT id, user_id, tags
   FROM events
   LEFT ARRAY JOIN tags
   WHERE toDate(created_at) = ?\`,
  [today],
);
```

`LEFT ARRAY JOIN` is analogous to a LEFT JOIN in standard SQL — you get at least one row per source row, even when the array is empty.

## Practical Use Case: Tag Analytics

Here's a complete example — find the top tags used in events this month, with the count of unique users who used each tag:

```typescript
async function getTopTags(month: string) {
  // month format: '2026-04'
  return db
    .rawQuery<{ tags: string; uses: string; unique_users: string }>(
      \`SELECT tags, count() AS uses, uniq(user_id) AS unique_users
       FROM events
       ARRAY JOIN tags
       WHERE tags != ''
         AND formatDateTime(created_at, '%Y-%m') = ?
       GROUP BY tags
       ORDER BY uses DESC
       LIMIT 10\`,
      [month],
    );
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

This joins `tags` and `tag_weights` in parallel (both arrays must have the same length). In a hypequery project today, this is another case where raw SQL is the honest approach rather than a dedicated builder helper.

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

The key TypeScript behaviour to remember: after ARRAY JOIN, the exploded column's type changes from the array type to the element type. If your schema has `tags: string[]`, the SQL result rows after `ARRAY JOIN tags` have `tags: string`. In a hypequery app today, model that explicitly in the `rawQuery<T>()` type parameter.
