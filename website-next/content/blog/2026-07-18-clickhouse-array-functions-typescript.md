---
title: "ClickHouse Array Functions in TypeScript — A Practical Guide"
description: "A working tour of ClickHouse's array toolkit from TypeScript: groupArray to collect rows into arrays, arrayMap and arrayFilter to transform them, ARRAY JOIN to flatten them back — with typed hypequery examples throughout."
seoTitle: "ClickHouse Array Functions in TypeScript: A Practical Guide"
seoDescription: "How to use ClickHouse array functions from TypeScript: groupArray, arrayMap, arrayFilter, ARRAY JOIN, arraySum, has, and hasAny — with type-safe hypequery examples and a full collect-filter-transform pipeline."
pubDate: 2026-07-18
heroImage: ""
slug: clickhouse-array-functions-typescript
status: published
tags:
  - ClickHouse
  - TypeScript
---

ClickHouse treats arrays as a first-class data type. `Array(String)` is a normal column, and the standard library around it (`groupArray`, `arrayMap`, `arrayFilter`, `ARRAY JOIN`, `arraySum`, `has`) is one of the main reasons analytics queries that would take three CTEs in Postgres collapse into one statement in ClickHouse.

**Short answer:** the array toolkit has three moves, and almost every array query is some combination of them:

1. **Collect** rows into an array with `groupArray(col)` — the inverse of a join, one array per group.
2. **Transform** the array in place with `arrayMap(x -> expr, arr)` and `arrayFilter(x -> cond, arr)` — higher-order functions with lambda syntax.
3. **Flatten** an array back into rows with `ARRAY JOIN` when you want to aggregate over individual elements.

From TypeScript, hypequery gives you `ARRAY JOIN` as native builder methods (`.arrayJoin()` / `.leftArrayJoin()`), and the array *functions* as raw SQL expressions inside `.select([...])` via `selectExpr`. They're expressions, not clauses, so that's the honest place for them:

```typescript
import { createQueryBuilder, selectExpr } from '@hypequery/clickhouse';
import type { IntrospectedSchema } from './generated/schema.js';

const db = createQueryBuilder<IntrospectedSchema>({
  url: process.env.CLICKHOUSE_URL!,
  username: process.env.CLICKHOUSE_USERNAME!,
  password: process.env.CLICKHOUSE_PASSWORD,
  database: process.env.CLICKHOUSE_DATABASE!,
});

// Collect each user's pages, drop internal ones, normalize — one query
const journeys = await db
  .table('events')
  .select([
    'user_id',
    selectExpr(
      "arrayMap(x -> lower(x), arrayFilter(x -> x NOT LIKE '/internal%', groupArray(page_path)))",
      'journey'
    ),
  ])
  .groupBy('user_id')
  .execute();
```

If you want to run these examples against your own schema, the [quick start](/docs/quick-start) gets you from `npm install` to typed queries in a few minutes, and the [ClickHouse query builder guide](/clickhouse-query-builder) covers the rest of the builder surface. The rest of this post walks through each function with a realistic product-analytics schema, then builds the full collect → filter → transform pipeline.

## The Schema

One events table, used consistently below:

```sql
CREATE TABLE events (
  tenant_id UInt32,
  user_id String,
  event_type String,
  page_path String,
  tags Array(String),
  duration_ms UInt32,
  created_at DateTime
) ENGINE = MergeTree()
ORDER BY (tenant_id, user_id, created_at);
```

Run `hypequery generate` and the generated schema types `tags` as `string[]`. ClickHouse arrays come back over HTTP as real JSON arrays, so the TypeScript type matches the runtime shape exactly. Every array function below produces a column whose JS representation is a plain array you can `.map()` over in application code.

## groupArray: Collect Rows Into Arrays

[`groupArray(col)`](/clickhouse/functions/group-array) is an aggregate function like `sum()` or `count()`, except instead of reducing a group to a number it collects the group's values into an array. It's how you turn "one row per event" into "one row per user, with their events inside it":

```sql
SELECT user_id, groupArray(page_path) AS pages
FROM events
WHERE tenant_id = 42
GROUP BY user_id
```

In hypequery, `groupArray` isn't a dedicated builder method the way `.sum()` or `.count()` are — it goes through `selectExpr`:

```typescript
const userPages = await db
  .table('events')
  .select(['user_id', selectExpr('groupArray(page_path)', 'pages')])
  .where('tenant_id', 'eq', 42)
  .groupBy('user_id')
  .execute();

// userPages[0].pages is string[]
```

One caveat worth knowing before you build session-replay features on this: `groupArray` collects values in whatever order rows arrive from storage, which is not guaranteed to be chronological. If the sequence order matters, sort the rows first (an inner query ordered by `created_at`) rather than trusting the default read order.

Also note the type of what comes back. `groupArray(page_path)` on a `String` column gives `string[]`, but `groupArray(some_uint64_col)` gives `string[]` too, because ClickHouse serializes `UInt64` as strings in JSON to avoid JS precision loss. hypequery's generated types encode this, so the compiler tells you before production does.

## arrayMap: Transform Every Element

[`arrayMap(x -> expr, arr)`](/clickhouse/functions/array-map) applies an expression to each element and returns a new array of the same length. The lambda syntax is `x -> expr`, ClickHouse's arrow, not JavaScript's:

```sql
-- Prefix every tag for display
SELECT arrayMap(x -> concat('#', x), tags) AS display_tags
FROM events
```

```typescript
const tagged = await db
  .table('events')
  .select(['user_id', selectExpr("arrayMap(x -> concat('#', x), tags)", 'display_tags')])
  .limit(100)
  .execute();
```

The lambda can reference other columns from the same row, not just `x`: `arrayMap(x -> concat(event_type, ':', x), tags)` is valid. That's a genuine difference from mapping in application code, where you'd have to carry the extra column along manually.

## arrayFilter: Prune Elements

[`arrayFilter(x -> cond, arr)`](/clickhouse/functions/array-filter) keeps only the elements where the lambda returns non-zero:

```sql
-- Keep only app-route paths, drop marketing pages
SELECT arrayFilter(x -> x LIKE '/app/%', groupArray(page_path)) AS app_pages
FROM events
GROUP BY user_id
```

Filtering *inside* the array is the key distinction from `WHERE`. A `WHERE page_path LIKE '/app/%'` filter would remove rows before collection — users who never touched `/app/` disappear from the result entirely. `arrayFilter` after `groupArray` keeps every user and prunes their array, so users with zero app pages show up with an empty array. Which one you want depends on the question, and it's a real off-by-a-cohort trap: "users and their app pages" versus "users who used the app, and their pages" are different queries.

Note that `arrayFilter` here operates on the `groupArray` output, so it belongs inside the aggregate expression, not in a `.where()` call.

## ARRAY JOIN: Flatten Arrays Into Rows

`ARRAY JOIN` goes the other direction — it explodes each array element into its own row, which is what you need when you want to `GROUP BY` individual elements. Unlike the functions above, this is a clause, and hypequery supports it as a native, typed builder method:

```typescript
const tagCounts = await db
  .table('events')
  .arrayJoin('tags')
  .select(['tags'])
  .count('tags', 'event_count')
  .where('tenant_id', 'eq', 42)
  .groupBy('tags')
  .orderBy('event_count', 'DESC')
  .limit(20)
  .execute();
```

That's the classic tag-frequency query: explode `tags`, count rows per element. `.arrayJoin()` drops rows whose array is empty; `.leftArrayJoin()` keeps them, with the element column set to the type's default value (empty string for `Array(String)`). It's the same regular-vs-LEFT distinction as ordinary joins.

`ARRAY JOIN` also gives you the practical answer to array membership filters. ClickHouse's `has(tags, 'checkout')` works in SQL `WHERE` clauses, but hypequery's typed `.where()` operators don't include array membership, so the builder-native pattern is to flatten and filter on the element:

```typescript
// Users who tagged an event 'checkout' this week
const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

const checkoutUsers = await db
  .table('events')
  .arrayJoin('tags')
  .select(['user_id'])
  .where('tags', 'eq', 'checkout')
  .where('created_at', 'gte', sevenDaysAgo)
  .distinct()
  .execute();
```

The `.distinct()` matters: after flattening, a user appears once per matching element, and dedup brings it back to one row per user. There's more depth here (multiple arrays joined in lockstep, `LEFT ARRAY JOIN` semantics, when flattening beats array functions) that the dedicated [ARRAY JOIN guide](/blog/clickhouse-array-join-typescript) covers.

## The Pipeline: Collect, Prune, Transform in One Query

The three moves compose, and the composition is the payoff. Say you want each user's journey through the app over the last week: the pages they visited, without internal admin routes, normalized to lowercase for consistent downstream grouping.

The SQL reads inside-out — collect, then filter, then map:

```sql
SELECT
  user_id,
  arrayMap(x -> lower(x),
    arrayFilter(x -> x NOT LIKE '/internal%',
      groupArray(page_path)
    )
  ) AS journey
FROM events
WHERE tenant_id = 42
  AND created_at >= now() - INTERVAL 7 DAY
GROUP BY user_id
```

And the hypequery version, with the row-level filters staying in typed `.where()` calls and only the array expression itself in raw SQL:

```typescript
const journeys = await db
  .table('events')
  .select([
    'user_id',
    selectExpr(
      "arrayMap(x -> lower(x), arrayFilter(x -> x NOT LIKE '/internal%', groupArray(page_path)))",
      'journey'
    ),
  ])
  .where('tenant_id', 'eq', 42)
  .where('created_at', 'gte', sevenDaysAgo)
  .groupBy('user_id')
  .execute();

// journeys: Array<{ user_id: string; journey: string[] }>
```

The equivalent without array functions is a subquery to filter events, an aggregation to collect them, and a post-processing pass in JavaScript to normalize: three network-visible stages instead of one scan. The array pipeline does all of it inside the aggregation, on the server, in a single pass over the data.

Numeric arrays compose the same way. "Engaged time per user, counting only views longer than a second":

```typescript
const engagement = await db
  .table('events')
  .select([
    'user_id',
    selectExpr('arrayCount(x -> x > 1000, groupArray(duration_ms))', 'engaged_views'),
    selectExpr('arraySum(arrayFilter(x -> x > 1000, groupArray(duration_ms)))', 'engaged_time_ms'),
  ])
  .where('tenant_id', 'eq', 42)
  .groupBy('user_id')
  .execute();
```

One honest note on `engaged_time_ms`: summing `UInt32` values widens to `UInt64`, which arrives in JS as a string. Convert with `Number()` if the values fit within a safe integer, or keep it as a string for display.

## The Rest of the Toolkit, Briefly

You'll reach for these less often, but they round out the surface:

- **`arraySum(arr)`** — sum of elements; also takes a lambda form `arraySum(x -> expr, arr)`.
- **`arrayCount(x -> cond, arr)`** — how many elements match; `arrayCount(arr)` alone counts non-zero elements.
- **`has(arr, elem)`** — 1 if the array contains the element. The go-to membership check in raw SQL `WHERE` clauses.
- **`hasAny(arr1, arr2)`** — 1 if the arrays share any element; `hasAny(tags, ['promo', 'discount'])` is "tagged with either".
- **`length(arr)`** — element count; `selectExpr('length(tags)', 'tag_count')` is often all the "array analytics" a dashboard needs.

All of them are expressions, so from hypequery they travel through `selectExpr` (or `rawAs`) inside `.select([...])`.

## What's Typed and What Isn't

Worth being precise about the tradeoff in these examples. Everything the builder handles natively — `.arrayJoin('tags')`, `.where()`, `.groupBy()`, `.orderBy()` — is checked against your generated schema; a typo in a column name fails at compile time. Inside a `selectExpr` string, you're writing raw SQL: `groupArray(page_paht)` won't be caught until ClickHouse rejects it at runtime.

That's a deliberate design position rather than a gap. Array function calls are arbitrary nested expressions with lambdas; a builder API that tried to model `arrayMap(x -> lower(x), arrayFilter(...))` as chained method calls would be longer than the SQL and harder to read. The practical pattern that keeps most of the safety: keep row selection, filtering, grouping, and ordering in typed builder methods, and confine raw SQL to the one expression that genuinely is an expression. The result column still lands in your typed result set under the alias you gave it in `selectExpr`.

## Where to Go From Here

- [How to use ARRAY JOIN in ClickHouse with TypeScript](/blog/clickhouse-array-join-typescript) — the flattening side in full: multiple arrays, LEFT ARRAY JOIN, tag explosion patterns.
- [Filter operators in the hypequery builder](/blog/clickhouse-filter-operators-typescript) — the typed `.where()` surface used alongside every array expression above.
- [ClickHouse for product analytics](/clickhouse-product-analytics) — the broader event-analytics patterns that journeys, tags, and engagement metrics feed into.
