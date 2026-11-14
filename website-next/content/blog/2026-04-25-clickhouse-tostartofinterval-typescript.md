---
title: "ClickHouse toStartOfInterval: GROUP BY, Return Types and TypeScript"
description: "toStartOfInterval rounds a timestamp down to the start of a 5-minute, hourly, daily or weekly bucket. How to group by it, what type it returns for each interval, how week buckets are anchored, and how to fill empty buckets, with TypeScript examples."
seoTitle: "ClickHouse toStartOfInterval: GROUP BY and Return Types"
seoDescription: "toStartOfInterval(ts, INTERVAL 5 MINUTE) buckets timestamps. Group by its alias, fill gaps with WITH FILL, and note it returns DateTime or Date by interval."
pubDate: 2026-04-25
updatedAt: 2026-11-08
heroImage: ""
slug: clickhouse-tostartofinterval-typescript
status: published
tags:
  - ClickHouse
  - TypeScript
---

`toStartOfInterval(ts, INTERVAL n unit)` rounds a timestamp down to the start of the bucket it falls in, so `GROUP BY toStartOfInterval(created_at, INTERVAL 5 MINUTE)` gives one row per 5-minute bucket. It returns a `DateTime` for SECOND, MINUTE, HOUR and DAY intervals, a `Date` for WEEK, MONTH, QUARTER and YEAR, and a `DateTime64` only for sub-second intervals on a `DateTime64` column. Buckets with no rows are missing from the result unless you add `ORDER BY ... WITH FILL`.

Every query below was run on ClickHouse 26.6.

## How toStartOfInterval rounds a timestamp

The result is the floor of the timestamp: the start of the interval that contains it.

```sql
SELECT
    toStartOfInterval(toDateTime('2026-04-25 14:37:22'), INTERVAL 1 HOUR) AS hour,       -- 2026-04-25 14:00:00
    toStartOfInterval(toDateTime('2026-04-25 14:37:22'), INTERVAL 15 MINUTE) AS quarter, -- 2026-04-25 14:30:00
    toStartOfInterval(toDateTime('2026-04-25 14:37:22'), INTERVAL 1 DAY) AS day;         -- 2026-04-25 00:00:00
```

It accepts SECOND, MINUTE, HOUR, DAY, WEEK, MONTH, QUARTER and YEAR on any timestamp. MILLISECOND, MICROSECOND and NANOSECOND work only on `DateTime64` columns; on a `DateTime` they fail with `ILLEGAL_TYPE_OF_ARGUMENT`.

## How to GROUP BY toStartOfInterval

Give the expression an alias and group by the alias:

```sql
SELECT
    toStartOfInterval(created_at, INTERVAL 1 HOUR) AS bucket,
    count() AS events
FROM events
GROUP BY bucket
ORDER BY bucket;
```

ClickHouse lets you define the alias anywhere in the query, so this also works and returns the same rows:

```sql
SELECT count() AS events
FROM events
GROUP BY toStartOfInterval(created_at, INTERVAL 1 HOUR) AS bucket
ORDER BY bucket;
```

Defining it in `SELECT` is clearer when you also want the bucket in the output.

## What type does toStartOfInterval return?

The type depends on the interval, not only on the input:

| Interval | Input `DateTime` | Input `DateTime64(6)` | Input `Date` |
|---|---|---|---|
| SECOND, MINUTE, HOUR, DAY | `DateTime` | `DateTime` | `DateTime` |
| WEEK, MONTH, QUARTER, YEAR | `Date` | `Date` | `Date` |
| MILLISECOND, MICROSECOND, NANOSECOND | error | `DateTime64` | error |

Two results surprise people. A `DateTime64` column bucketed by a second or more comes back as `DateTime`, so the fraction of a second is gone. And a `Date` bucketed by `INTERVAL 1 DAY` comes back as a `DateTime`. An origin passed as the third argument must have the same type as the timestamp, and then the result keeps the timestamp's type: `DateTime` in, `DateTime` out, even for WEEK or MONTH.

## Which day do week buckets start on?

Without an origin, `INTERVAL 1 WEEK` buckets start on Monday. For 2026-11-08, a Sunday, `toStartOfInterval(ts, INTERVAL 1 WEEK)` returns 2026-11-02. To start weeks on another day, pass an origin on that weekday:

```sql
SELECT toStartOfInterval(
    toDateTime('2026-11-08 10:17:33', 'UTC'),
    INTERVAL 1 WEEK,
    toDateTime('2026-01-03 00:00:00', 'UTC')  -- a Saturday
) AS saturday_week;  -- 2026-11-07 00:00:00
```

Note that `toStartOfWeek(ts)` starts weeks on Sunday by default, so the two functions disagree unless you pass `toStartOfWeek(ts, 1)`. See [toStartOfWeek](/clickhouse/functions/to-start-of-week).

## How to fill empty buckets with WITH FILL

`GROUP BY` only returns buckets that have rows. Add `WITH FILL` to the `ORDER BY` to generate the missing ones with zero counts:

```sql
SELECT
    toStartOfInterval(created_at, INTERVAL 1 HOUR) AS bucket,
    count() AS events
FROM events
WHERE tenant_id = 1
  AND created_at >= '2026-04-25 00:00:00'
  AND created_at < '2026-04-25 06:00:00'
GROUP BY bucket
ORDER BY bucket ASC WITH FILL
    FROM toDateTime('2026-04-25 00:00:00')
    TO toDateTime('2026-04-25 06:00:00')
    STEP INTERVAL 1 HOUR;
```

With three rows at 01:10, 01:50 and 04:05, this returns six buckets: 0, 2, 0, 0, 1 and 0 events.

## Using toStartOfInterval from TypeScript with hypequery

Select the expression with `rawAs` and give it a type. `DateTime` results arrive as strings such as `"2026-04-25 14:00:00"`, and `count()` and `uniq()` return `UInt64`, which hypequery receives as strings so large counts keep their precision.

```ts
import { createQueryBuilder, rawAs } from '@hypequery/clickhouse';
import type { IntrospectedSchema } from './schema';

const db = createQueryBuilder<IntrospectedSchema>({
  host: process.env.CLICKHOUSE_HOST!,
  username: process.env.CLICKHOUSE_USERNAME!,
  password: process.env.CLICKHOUSE_PASSWORD!,
  database: process.env.CLICKHOUSE_DATABASE!,
});

// Only these strings ever reach the SQL, so the interval can't be injected
const intervals = {
  '15min': 'INTERVAL 15 MINUTE',
  '1hour': 'INTERVAL 1 HOUR',
  '1day': 'INTERVAL 1 DAY',
} as const;

export async function eventTimeSeries(
  tenantId: number,
  from: string, // "2026-04-25 00:00:00"
  to: string,
  granularity: keyof typeof intervals,
) {
  return db
    .table('events')
    .select([
      rawAs<string, 'bucket'>(`toStartOfInterval(created_at, ${intervals[granularity]})`, 'bucket'),
      rawAs<string, 'events'>('count()', 'events'),
      rawAs<string, 'unique_users'>('uniq(user_id)', 'unique_users'),
    ])
    .where('tenant_id', 'eq', tenantId)
    .where('created_at', 'gte', from)
    .where('created_at', 'lt', to)
    .groupBy('bucket')
    .orderBy('bucket', 'ASC')
    .execute();
}
```

To turn a bucket into a JavaScript `Date`, render it in a known zone and parse it as that zone: with a UTC column, `new Date(row.bucket.replace(' ', 'T') + 'Z')`.

## Related

- [toStartOfWeek: Sunday or Monday](/clickhouse/functions/to-start-of-week)
- [formatDateTime for bucket labels](/clickhouse/functions/format-date-time)
- [DateTime vs DateTime64 and time zones](/blog/clickhouse-datetime-vs-datetime64-time-zones): why a DateTime64 bucket comes back as DateTime
- [ClickHouse time-series patterns](/clickhouse-time-series)
- [PREWHERE vs WHERE](/blog/clickhouse-prewhere-vs-where)
- ClickHouse docs: [toStartOfInterval](https://clickhouse.com/docs/sql-reference/functions/date-time-functions#toStartOfInterval), [ORDER BY ... WITH FILL](https://clickhouse.com/docs/sql-reference/statements/select/order-by#order-by-expr-with-fill-modifier)
