---
title: "ClickHouse Date Functions in TypeScript — toStartOfDay, toStartOfQuarter, and More"
description: "Practical guide to ClickHouse date bucketing functions in TypeScript — toStartOfDay, toStartOfWeek, toStartOfMonth, toStartOfQuarter, and toStartOfInterval."
seoTitle: "ClickHouse Date Functions TypeScript — toStartOfDay, toStartOfQuarter, toStartOfInterval"
seoDescription: "Practical guide to ClickHouse date bucketing functions in TypeScript — toStartOfDay, toStartOfWeek, toStartOfMonth, toStartOfQuarter, and toStartOfInterval."
pubDate: 2026-04-25
heroImage: ""
slug: clickhouse-date-functions-typescript
status: published
---

ClickHouse date functions are central to real analytics work, but the TypeScript failure mode is usually not the SQL itself. It is forgetting what comes back over HTTP. This post covers the main bucketing functions, what they return, and how to use them in hypequery without hiding the string-based return types.

## Return Types: Strings, Not JS Date Objects

Before the function list — the single most important thing to understand when using ClickHouse date functions in TypeScript: **they return strings to the client, not JavaScript Date objects**.

- `DateTime` results come back as `"YYYY-MM-DD HH:MM:SS"` — e.g. `"2026-04-25 14:00:00"`
- `Date` results come back as `"YYYY-MM-DD"` — e.g. `"2026-04-25"`

hypequery's schema generator reflects this: `DateTime` columns are typed as `string`, `Date` columns as `string`. There is no automatic coercion. If you need a JS `Date` object, parse it explicitly:

```typescript
// DateTime string → JS Date (treat as UTC)
const d = new Date(row.bucket.replace(' ', 'T') + 'Z');

// Date string → JS Date
const d = new Date(row.day + 'T00:00:00Z');
```

## The Date Bucketing Functions

| Function | Input | Output | Rounds To |
|----------|-------|--------|-----------|
| `toStartOfMinute(dt)` | DateTime | DateTime | Start of the minute |
| `toStartOfFiveMinutes(dt)` | DateTime | DateTime | Start of the 5-minute block |
| `toStartOfTenMinutes(dt)` | DateTime | DateTime | Start of the 10-minute block |
| `toStartOfFifteenMinutes(dt)` | DateTime | DateTime | Start of the 15-minute block |
| `toStartOfHour(dt)` | DateTime | DateTime | Start of the hour |
| `toStartOfDay(dt)` | DateTime/Date | Date | Start of the day |
| `toStartOfWeek(dt[, mode])` | DateTime/Date | Date | Start of the week (Sunday=0 by default) |
| `toStartOfMonth(dt)` | DateTime/Date | Date | First day of the month |
| `toStartOfQuarter(dt)` | DateTime/Date | Date | First day of the quarter (Jan 1, Apr 1, Jul 1, Oct 1) |
| `toStartOfYear(dt)` | DateTime/Date | Date | January 1st of the year |
| `toStartOfInterval(dt, INTERVAL n unit)` | DateTime/Date | DateTime/Date | Start of any interval |

Note that `toStartOfDay` and below return `Date` not `DateTime` — the string format changes from `"YYYY-MM-DD HH:MM:SS"` to `"YYYY-MM-DD"`.

## toStartOfQuarter

`toStartOfQuarter` is the function that brings the most questions, since "quarter" boundaries aren't immediately obvious. ClickHouse uses calendar quarters:

- Q1: January 1 – March 31 → bucketed to `2026-01-01`
- Q2: April 1 – June 30 → bucketed to `2026-04-01`
- Q3: July 1 – September 30 → bucketed to `2026-07-01`
- Q4: October 1 – December 31 → bucketed to `2026-10-01`

```sql
SELECT
  toStartOfQuarter(created_at) AS quarter,
  sum(revenue) AS total_revenue
FROM orders
GROUP BY quarter
ORDER BY quarter
```

Result rows: `{ quarter: "2026-01-01", total_revenue: "482910" }` — the quarter is represented by its first day as a `Date` string.

## SQL Examples with GROUP BY Alias

ClickHouse allows `GROUP BY` to reference aliases defined in `SELECT`. All of these work:

```sql
-- Hourly
SELECT toStartOfHour(created_at) AS bucket, count() AS events
FROM events GROUP BY bucket ORDER BY bucket;

-- Daily
SELECT toStartOfDay(created_at) AS day, count() AS events
FROM events GROUP BY day ORDER BY day;

-- Weekly
SELECT toStartOfWeek(created_at) AS week, count() AS events
FROM events GROUP BY week ORDER BY week;

-- Monthly
SELECT toStartOfMonth(created_at) AS month, sum(amount) AS revenue
FROM orders GROUP BY month ORDER BY month;

-- Quarterly
SELECT toStartOfQuarter(created_at) AS quarter, sum(amount) AS revenue
FROM orders GROUP BY quarter ORDER BY quarter;

-- Custom interval (90 minutes)
SELECT toStartOfInterval(created_at, INTERVAL 90 MINUTE) AS bucket, count() AS events
FROM events GROUP BY bucket ORDER BY bucket;
```

## Using Date Functions in hypequery

Pass the function call as a string expression in `.select()`:

```typescript
import { createQueryBuilder } from '@hypequery/clickhouse';
import type { Schema } from './schema';

const db = createQueryBuilder<Schema>({ host: 'http://localhost:8123' });

// Monthly revenue
const monthlyRevenue = await db
  .table('orders')
  .select(
    'toStartOfMonth(created_at) AS month',
    'sum(amount) AS revenue',
    'count() AS order_count'
  )
  .where('tenant_id', 'eq', tenantId)
  .where('created_at', 'gte', '2026-01-01 00:00:00')
  .groupBy(['month'])
  .orderBy('month', 'ASC')
  .execute();

// monthlyRevenue[0] → { month: "2026-01-01", revenue: "48291", order_count: "312" }

// Quarterly summary
const quarterlyStats = await db
  .table('orders')
  .select(
    'toStartOfQuarter(created_at) AS quarter',
    'sum(amount) AS revenue',
    'uniq(user_id) AS unique_customers'
  )
  .where('tenant_id', 'eq', tenantId)
  .groupBy(['quarter'])
  .orderBy('quarter', 'ASC')
  .execute();
```

## A Reusable Granularity Helper

Dashboards typically let users pick a time granularity. Here's a helper that maps a granularity option to the right ClickHouse function, with TypeScript types for the result:

```typescript
type Granularity = 'minute' | '5min' | '15min' | 'hour' | 'day' | 'week' | 'month' | 'quarter' | 'year';

function bucketExpression(granularity: Granularity, column: string = 'created_at'): string {
  switch (granularity) {
    case 'minute':  return `toStartOfMinute(${column})`;
    case '5min':    return `toStartOfFiveMinutes(${column})`;
    case '15min':   return `toStartOfFifteenMinutes(${column})`;
    case 'hour':    return `toStartOfHour(${column})`;
    case 'day':     return `toStartOfDay(${column})`;
    case 'week':    return `toStartOfWeek(${column})`;
    case 'month':   return `toStartOfMonth(${column})`;
    case 'quarter': return `toStartOfQuarter(${column})`;
    case 'year':    return `toStartOfYear(${column})`;
  }
}

async function getTimeSeries(
  tenantId: number,
  from: string,
  to: string,
  granularity: Granularity
) {
  const bucket = bucketExpression(granularity);

  return db
    .table('events')
    .select(
      `${bucket} AS bucket`,
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

Usage:

```typescript
const data = await getTimeSeries(
  42,
  '2026-01-01 00:00:00',
  '2026-04-01 00:00:00',
  'month'
);
// data[0] → { bucket: "2026-01-01", events: "14820", unique_users: "3102" }
```

## toStartOfWeek and the Mode Parameter

`toStartOfWeek` takes an optional second parameter for the week start day:

```sql
-- Week starts Sunday (default, mode 0)
SELECT toStartOfWeek(created_at) AS week FROM events GROUP BY week;

-- Week starts Monday (mode 1)
SELECT toStartOfWeek(created_at, 1) AS week FROM events GROUP BY week;
```

If your application uses ISO weeks (Monday start), pass `1` as the second argument. The string you get back is the date of the week's first day.

## toStartOfInterval: The Flexible Option

When none of the fixed-granularity functions fit — say you need 6-hour blocks or 2-week periods — `toStartOfInterval` handles it:

```sql
SELECT
  toStartOfInterval(created_at, INTERVAL 6 HOUR) AS bucket,
  count() AS events
FROM events
GROUP BY bucket
ORDER BY bucket
```

See [ClickHouse toStartOfInterval with GROUP BY in TypeScript](/blog/clickhouse-tostartofinterval-typescript) for a deeper treatment of this function including the alias rules and gap filling.

---

Related: [ClickHouse Time-Series Patterns](/clickhouse-time-series) · [toStartOfInterval with GROUP BY](/blog/clickhouse-tostartofinterval-typescript) · [ClickHouse TypeScript Guide](/clickhouse-typescript)
