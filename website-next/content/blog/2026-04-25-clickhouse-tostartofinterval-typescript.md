---
title: "ClickHouse toStartOfInterval with GROUP BY in TypeScript"
description: "How to use toStartOfInterval with GROUP BY and column aliases in ClickHouse. TypeScript examples using hypequery and raw SQL — DateTime bucketing for time-series analytics."
seoTitle: "ClickHouse toStartOfInterval GROUP BY Alias — TypeScript Examples"
seoDescription: "How to use toStartOfInterval with GROUP BY and column aliases in ClickHouse. TypeScript examples using hypequery and raw SQL — DateTime bucketing for time-series analytics."
pubDate: 2026-04-25
heroImage: ""
slug: clickhouse-tostartofinterval-typescript
status: published
---

`toStartOfInterval` is the most flexible date bucketing function in ClickHouse. Instead of reaching for a separate function for each granularity — `toStartOfHour`, `toStartOfDay`, `toStartOfWeek` — you can use a single function with an `INTERVAL` expression to bucket a `DateTime` into any interval you need.

## What toStartOfInterval Does

`toStartOfInterval(datetime, INTERVAL n unit)` rounds a `DateTime` down to the start of the containing interval. The result is the floor of the timestamp, not a midpoint or ceiling.

```sql
-- 2026-04-25 14:37:22 bucketed to 1-hour intervals → 2026-04-25 14:00:00
SELECT toStartOfInterval(toDateTime('2026-04-25 14:37:22'), INTERVAL 1 HOUR);

-- Same timestamp bucketed to 15-minute intervals → 2026-04-25 14:30:00
SELECT toStartOfInterval(toDateTime('2026-04-25 14:37:22'), INTERVAL 15 MINUTE);

-- Bucketed to 1-day intervals → 2026-04-25 00:00:00
SELECT toStartOfInterval(toDateTime('2026-04-25 14:37:22'), INTERVAL 1 DAY);
```

Supported interval units: `SECOND`, `MINUTE`, `HOUR`, `DAY`, `WEEK`, `MONTH`, `QUARTER`, `YEAR`. This makes it more flexible than the fixed-granularity helpers like `toStartOfHour` or `toStartOfDay`, which only do one thing.

## Basic GROUP BY with an Alias

Here is a time-series query that counts events per hour:

```sql
SELECT
  toStartOfInterval(created_at, INTERVAL 1 HOUR) AS bucket,
  count() AS events
FROM events
GROUP BY bucket
ORDER BY bucket
```

ClickHouse allows `GROUP BY bucket` where `bucket` is an alias defined in the `SELECT` clause. This is one area where ClickHouse differs from strict SQL dialects — standard SQL does not allow grouping by a `SELECT`-level alias, but ClickHouse does.

The key constraint: the alias must be defined in the same `SELECT` clause. You cannot reference an alias from a subquery's SELECT in an outer GROUP BY, and you cannot invent aliases that aren't in SELECT. This query fails:

```sql
-- Wrong: 'bucket' alias doesn't exist in SELECT
SELECT count() AS events
FROM events
GROUP BY toStartOfInterval(created_at, INTERVAL 1 HOUR) AS bucket
ORDER BY bucket
```

The correct pattern is to define the alias in SELECT and then reference it in GROUP BY, as shown in the working example above.

## What toStartOfInterval Returns

`toStartOfInterval` returns a `DateTime` when the input is `DateTime`, and a `Date` when the input is `Date`. In both cases ClickHouse returns this as a **string** to the client — not a JavaScript `Date` object.

A `DateTime` result looks like `"2026-04-25 14:00:00"`. A `Date` result looks like `"2026-04-25"`. There is no automatic coercion to a JS `Date` — you parse it yourself if needed:

```typescript
const date = new Date(row.bucket.replace(' ', 'T') + 'Z'); // treat as UTC
```

This is consistent with how hypequery maps ClickHouse types: `DateTime` columns in the schema are typed as `string`, `Date` columns as `string`. The value coming back from `toStartOfInterval` is the same shape.

## Using toStartOfInterval in hypequery

hypequery's `.select()` accepts raw SQL expressions as strings. This is the straightforward way to use `toStartOfInterval`:

```typescript
import { createQueryBuilder } from '@hypequery/clickhouse';
import type { Schema } from './schema';

const db = createQueryBuilder<Schema>({ host: 'http://localhost:8123' });

const result = await db
  .table('events')
  .select(
    'toStartOfInterval(created_at, INTERVAL 1 HOUR) AS bucket',
    'count() AS events'
  )
  .where('tenant_id', 'eq', tenantId)
  .groupBy(['bucket'])
  .orderBy('bucket', 'ASC')
  .execute();

// result[0].bucket → "2026-04-25 14:00:00"
// result[0].events → "142"  (UInt64 comes back as string)
```

The schema-generated type for `created_at` is `string` (since ClickHouse `DateTime` maps to `string`), which is consistent with what `toStartOfInterval` hands back. No type mismatch to work around.

## A Practical Dashboard Query

Real dashboards usually need a variable granularity — hourly for short ranges, daily for longer ones. A common pattern:

```typescript
type Granularity = '15min' | '1hour' | '1day';

function intervalExpression(granularity: Granularity): string {
  switch (granularity) {
    case '15min':  return 'INTERVAL 15 MINUTE';
    case '1hour':  return 'INTERVAL 1 HOUR';
    case '1day':   return 'INTERVAL 1 DAY';
  }
}

async function getEventTimeSeries(
  tenantId: number,
  from: string,
  to: string,
  granularity: Granularity
) {
  const interval = intervalExpression(granularity);

  return db
    .table('events')
    .select(
      `toStartOfInterval(created_at, ${interval}) AS bucket`,
      'count() AS events',
      'uniq(user_id) AS unique_users'
    )
    .where('tenant_id', 'eq', tenantId)
    .where('created_at', 'gte', from)
    .where('created_at', 'lt', to)
    .groupBy(['bucket'])
    .orderBy('bucket', 'ASC')
    .execute();
}
```

If you later decide this query specifically needs an explicit ClickHouse `PREWHERE`, treat that as a raw SQL optimisation step rather than assuming there is a dedicated builder helper for it today. See [PREWHERE vs WHERE](/blog/clickhouse-prewhere-vs-where) for when that tradeoff matters.

## Filling Gaps

One limitation of this query: if there are no events in a time bucket, that bucket won't appear in the results. ClickHouse has a `WITH FILL` clause for ORDER BY that can generate missing intervals:

```sql
SELECT
  toStartOfInterval(created_at, INTERVAL 1 HOUR) AS bucket,
  count() AS events
FROM events
WHERE tenant_id = 1
  AND created_at >= '2026-04-25 00:00:00'
  AND created_at < '2026-04-26 00:00:00'
GROUP BY bucket
ORDER BY bucket ASC WITH FILL
  FROM toDateTime('2026-04-25 00:00:00')
  TO toDateTime('2026-04-26 00:00:00')
  STEP INTERVAL 1 HOUR
```

This fills in zero-count buckets automatically. It's a raw SQL feature — use it via an escape hatch if your dashboard needs gap filling at the database level.

---

Related: [ClickHouse Time-Series Patterns](/clickhouse-time-series) · [ClickHouse TypeScript Guide](/clickhouse-typescript) · [PREWHERE vs WHERE](/blog/clickhouse-prewhere-vs-where)
