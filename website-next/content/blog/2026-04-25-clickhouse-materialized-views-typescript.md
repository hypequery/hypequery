---
title: "ClickHouse Materialized Views for TypeScript Developers"
description: "ClickHouse materialized views trigger on INSERT and pre-aggregate into a target table. This guide explains the mechanics, the backfill gotcha, and how to query them with hypequery."
seoTitle: "ClickHouse Materialized Views — TypeScript Guide and Best Practices"
seoDescription: "ClickHouse materialized views pre-aggregate data as it's inserted. This guide explains how they work, when to use them, and how to query them with TypeScript and hypequery."
pubDate: 2026-04-25
heroImage: ""
slug: clickhouse-materialized-views-typescript
status: published
---

If you've used materialized views in Postgres, set that mental model aside before reading this. ClickHouse materialized views work differently in a way that matters a lot in practice.

## How ClickHouse Materialized Views Actually Work

In Postgres, a materialized view stores the result of a SELECT query. You refresh it manually (or on a schedule) and it re-runs the query against the current data.

In ClickHouse, a materialized view is an **INSERT trigger**. When data is inserted into the source table, the view's SELECT query runs against the new block of inserted data, and the result is appended to a separate target table. The view does not query historical data — it only processes data that arrives after the view was created.

This distinction has a critical implication: **if you create a materialized view on an existing table, it will only aggregate new inserts, not the data that's already there.** You need to backfill separately.

## A Concrete Example: Daily Event Counts

Source table:

```sql
CREATE TABLE events (
  id String,
  user_id String,
  event_type String,
  created_at DateTime
) ENGINE = MergeTree()
ORDER BY (created_at, id);
```

Target table (stores the pre-aggregated results):

```sql
CREATE TABLE events_daily_counts (
  date Date,
  event_type String,
  event_count AggregateFunction(count, UInt64),
  unique_users AggregateFunction(uniq, String)
) ENGINE = AggregatingMergeTree()
ORDER BY (date, event_type);
```

Materialized view that populates the target table on each insert:

```sql
CREATE MATERIALIZED VIEW events_daily_counts_mv
TO events_daily_counts
AS
SELECT
  toDate(created_at) AS date,
  event_type,
  countState() AS event_count,
  uniqState(user_id) AS unique_users
FROM events
GROUP BY date, event_type;
```

The `TO events_daily_counts` clause directs output to the target table. The `countState()` and `uniqState()` functions store partial aggregation state (using ClickHouse's AggregateFunction types), which the AggregatingMergeTree engine merges efficiently at read time.

## Backfilling Historical Data

After creating the view, insert historical data from the source table into the target table manually:

```sql
INSERT INTO events_daily_counts
SELECT
  toDate(created_at) AS date,
  event_type,
  countState() AS event_count,
  uniqState(user_id) AS unique_users
FROM events
GROUP BY date, event_type;
```

Run this once after creating the view. From that point forward, new inserts into `events` will automatically update `events_daily_counts` through the materialized view.

## Querying the Target Table with hypequery

Generate the schema including the target table:

```bash
npx @hypequery/cli generate --output ./schema.ts
```

The target table appears in the schema like any other table. Query it directly:

```typescript
import { createQueryBuilder } from '@hypequery/clickhouse';
import type { Schema } from './schema';

const db = createQueryBuilder<Schema>({
  host: process.env.CLICKHOUSE_HOST!,
  username: process.env.CLICKHOUSE_USER!,
  password: process.env.CLICKHOUSE_PASSWORD!,
});

// Get daily event counts for a date range
// Use the Merge combinator functions to combine partial aggregation states
async function getDailyEventCounts(startDate: string, endDate: string) {
  return db
    .table('events_daily_counts')
    .select(
      'date',
      'event_type',
      'countMerge(event_count) as total_events',
      'uniqMerge(unique_users) as unique_users'
    )
    .where('date', 'gte', startDate)
    .where('date', 'lte', endDate)
    .groupBy('date', 'event_type')
    .orderBy('date', 'ASC')
    .execute();
}

const counts = await getDailyEventCounts('2026-04-01', '2026-04-25');
```

The `countMerge()` and `uniqMerge()` functions combine the partial states stored by `countState()` and `uniqState()`. This is what AggregatingMergeTree is designed for — it accumulates partial states from multiple inserts and merges them at read time.

## When to Use Materialized Views

Materialized views make sense when:

- **You have high insert volume** and can't afford to run expensive aggregation queries on the raw events table.
- **You have predictable aggregation dimensions** — if you always query by `(date, event_type)`, a materialized view on those dimensions will always be faster than scanning the raw table.
- **Query latency matters more than slight staleness** — results reflect data at insert time, which for most analytics use cases is fine.

Avoid materialized views when:

- **The aggregation dimensions change often.** A new GROUP BY dimension means a new materialized view and backfill.
- **You need fully flexible ad-hoc queries.** Raw tables are more flexible. Materialized views trade flexibility for speed.
- **The source insert rate is low.** ClickHouse is already fast on raw data at low volume. The added complexity isn't worth it.

## Monitoring and Debugging

A materialized view that errors silently can cause data loss — inserts to the source table succeed, but the view doesn't update the target. Check for errors in:

```sql
SELECT * FROM system.part_log
WHERE table = 'events_daily_counts'
ORDER BY event_time DESC
LIMIT 20;
```

And verify the view definition is intact:

```sql
SHOW CREATE TABLE events_daily_counts_mv;
```

If the target table schema changes (column added, type changed), the materialized view may stop processing inserts. Test schema changes in a staging environment before applying to production.

## Summary

- ClickHouse materialized views trigger on INSERT, not on SELECT refresh
- They only process new data — backfill historical data separately
- Use `AggregatingMergeTree` + `*State` functions for correct incremental aggregation
- Query the target table with hypequery exactly like any other table — it's just another table in your schema
- Types are generated from the target table schema — the `AggregateFunction` columns show up as their return types after `*Merge()` is applied
