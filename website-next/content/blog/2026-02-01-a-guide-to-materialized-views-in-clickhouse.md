---
title: "ClickHouse materialized views: create, refresh and test them (with examples)"
description: "What a ClickHouse materialized view is, how incremental and refreshable views differ, and how to create, backfill, modify, list, drop and monitor them, with SQL that runs on a seeded database and a typed hypequery example."
seoTitle: "ClickHouse Materialized Views: Create, Refresh & Test Them (With Examples)"
seoDescription: "A ClickHouse materialized view is an insert trigger that writes to a target table. Learn incremental vs refreshable views, TO tables, backfills without POPULATE, engines, pitfalls, monitoring, and how to query them from TypeScript."
pubDate: 2026-01-11
updatedAt: 2026-11-08
heroImage: ""
tags: ["clickhouse", "materialized-views", "typescript"]
---


A materialized view in ClickHouse is an insert trigger: a `SELECT` that runs on every block of rows inserted into a source table and writes its result into a target table that you query instead of the raw data. It is not a cached query result you refresh by hand, with one exception: a *refreshable* materialized view, which re-runs its whole query on a schedule and replaces the target.

That difference is why materialized views can deliver 100x query speedups or silently lose data, explode storage by 10x, and tank your insert throughput. Most engineers arrive with the PostgreSQL mental model and get the wrong one.

This guide covers what production teams learn the hard way: how incremental and refreshable views differ, the exact statements to create, backfill, modify, list and drop them, which table engines to use, the mistakes that cause data loss and storage explosions, how to query the result from TypeScript, and when materialized views are the wrong tool entirely.

**Tested on ClickHouse 25.8.** Every statement in the [quick reference](#quick-reference-the-statements-you-will-search-for) and the TypeScript section runs in CI against a seeded one-million-row `events` table ([the seed](https://github.com/hypequery/hypequery/tree/main/examples/_seed), [the SQL](https://github.com/hypequery/hypequery/tree/main/guides/_blog-materialized-views)). The other examples use illustrative table names.

---

## Table of Contents

1. [The Insert Trigger Mental Model](#the-insert-trigger-mental-model)
2. [Quick Reference: The Statements You Will Search For](#quick-reference-the-statements-you-will-search-for)
3. [Incremental vs Refreshable: Two Different Tools](#incremental-vs-refreshable-two-different-tools)
4. [The TO Clause: Production Code vs Prototypes](#the-to-clause-production-code-vs-prototypes)
5. [Choosing the Right Table Engine](#choosing-the-right-table-engine)
6. [Production Pitfalls](#production-pitfalls)
7. [Materialized Views vs Projections](#materialized-views-vs-projections)
8. [Tiered Aggregation: The Production Pattern](#tiered-aggregation-the-production-pattern)
9. [In TypeScript with hypequery](#in-typescript-with-hypequery)
10. [Monitoring and Debugging](#monitoring-and-debugging)
11. [When NOT to Use Materialized Views](#when-not-to-use-materialized-views)
12. [FAQ](#faq)
13. [Conclusion](#conclusion)

---

## The Insert Trigger Mental Model

When you insert 10,000 rows into a source table, ClickHouse doesn't scan the entire table to update the materialized view. It takes only those 10,000 rows—sitting in a RAM buffer—runs your MV's SELECT statement against them, and writes the results to the target table. The MV never touches disk to read historical data.

```
INSERT INTO source_table (10,000 rows)
         ↓
Materialized view fires (processes only the inserted block)
         ↓
SELECT ... FROM source_table (but only those 10,000 rows)
         ↓
INSERT INTO target_table (pre-computed results)
         ↓
Queries read from target_table
```

This architecture has three critical implications:

**MVs only react to INSERT.** UPDATE and DELETE operations are invisible. If you delete rows from the source table, the aggregates in your MV target remain unchanged. If you update a row, the MV doesn't know.

**Processing happens per-block, not per-table.** Each insert batch is processed independently. If you insert 1,000 rows for user_id=123 in one batch and 500 rows for user_id=123 in another, you'll have two partial aggregate rows in the target until a background merge combines them.

**Insert operations become synchronous triggers.** A complex MV query that takes 200ms adds 200ms to every insert that hits the source table. Multiple MVs compound this overhead.

| Aspect | Regular View | Materialized View |
|--------|--------------|-------------------|
| Storage | Query definition only | Physical table on disk |
| When computed | On every SELECT | On every INSERT to source |
| Performance | Same as base query | Much faster (pre-computed) |
| Freshness | Always current | Current up to last insert |
| Reacts to UPDATE/DELETE | Yes | No |

---

## Quick Reference: The Statements You Will Search For

These are the statements the rest of this guide explains. They run against the seed dataset's `events` table (`event_id`, `tenant_id`, `user_id`, `event_type`, `status_code`, `latency_ms`, `occurred_at`).

### Create a materialized view

Create the target table first, then the view writing `TO` it. Store aggregate states, not finished numbers, so uniques stay correct when ClickHouse merges parts.

```sql
CREATE TABLE IF NOT EXISTS blog_events_daily
(
    day          Date,
    tenant_id    UInt32,
    events       SimpleAggregateFunction(sum, UInt64),
    unique_users AggregateFunction(uniq, UInt32)
)
ENGINE = AggregatingMergeTree
ORDER BY (tenant_id, day);

CREATE MATERIALIZED VIEW IF NOT EXISTS blog_events_daily_mv TO blog_events_daily AS
SELECT
    toDate(occurred_at) AS day,
    tenant_id,
    count()             AS events,
    uniqState(user_id)  AS unique_users
FROM events
GROUP BY day, tenant_id;
```

From this point on, every insert into `events` also lands, aggregated, in `blog_events_daily`. Nothing before this point is in the target yet; see the next statement.

### Backfill existing data (instead of POPULATE)

```sql
INSERT INTO blog_events_daily
SELECT
    toDate(occurred_at) AS day,
    tenant_id,
    count()             AS events,
    uniqState(user_id)  AS unique_users
FROM events
GROUP BY day, tenant_id;
```

Why not `POPULATE`? It blocks until it finishes, it cannot be combined with `TO`, and rows inserted while it runs are lost. [Details below](#populate-will-lose-your-data).

### Query the target table

```sql
SELECT
    day,
    sum(events)              AS events,
    uniqMerge(unique_users)  AS unique_users
FROM blog_events_daily
WHERE day BETWEEN '2026-10-25' AND '2026-10-31'
GROUP BY day
ORDER BY day;
```

`uniqMerge` finalizes the stored state. The `GROUP BY` is not optional: until a background merge runs, a key can have several partial rows.

### Change a materialized view's query (there is no CREATE OR REPLACE)

`CREATE OR REPLACE MATERIALIZED VIEW` is a syntax error in ClickHouse; `OR REPLACE` exists for tables and plain views only. To change the `SELECT` of an existing materialized view without touching the target table or its data, use `ALTER TABLE ... MODIFY QUERY`:

```sql
ALTER TABLE blog_events_daily_mv MODIFY QUERY
SELECT
    toDate(occurred_at) AS day,
    tenant_id,
    count()             AS events,
    uniqState(user_id)  AS unique_users
FROM events
WHERE event_type != 'error'
GROUP BY day, tenant_id;
```

The other safe route is `DROP VIEW` then `CREATE MATERIALIZED VIEW ... TO` again, which works because the rows live in the target table, not in the view. Either way, rows already in the target keep the old logic; backfill again if the change should apply to history.

### Show and list materialized views

```sql
-- All materialized views in the current database
SELECT name, engine, create_table_query
FROM system.tables
WHERE database = currentDatabase() AND engine = 'MaterializedView';

-- One view's definition
SHOW CREATE TABLE blog_events_daily_mv;

-- Which views depend on a source table
SELECT name, dependencies_table
FROM system.tables
WHERE database = currentDatabase() AND name = 'events';
```

Refreshable views also appear in `system.view_refreshes` with their schedule and last result; see the [refreshable materialized views guide](/guides/refreshable-materialized-views).

### Drop a materialized view

```sql
DROP VIEW IF EXISTS blog_events_daily_mv;
```

The target table and every row in it stay. Drop the table separately if you mean to.

### Create a refreshable materialized view

```sql
CREATE MATERIALIZED VIEW hourly_report_mv
REFRESH EVERY 1 HOUR
TO hourly_report AS
SELECT ... FROM source JOIN dimension_table ON ... GROUP BY ...;

SYSTEM REFRESH VIEW hourly_report_mv;   -- run it now
SYSTEM WAIT VIEW hourly_report_mv;      -- block until it finishes
```

The full treatment, including `DEPENDS ON`, `APPEND`, `RANDOMIZE FOR`, `ALTER ... MODIFY REFRESH` and monitoring, is in the [refreshable materialized views guide](/guides/refreshable-materialized-views).

---

## Incremental vs Refreshable: Two Different Tools

ClickHouse actually has two types of materialized views that solve different problems. Most documentation focuses on incremental MVs, but refreshable MVs (production-ready since ClickHouse 24.10) are often the better choice for complex transformations.

### Incremental Materialized Views

These are the "insert trigger" MVs described above. They process each inserted block in real-time and write results immediately to the target table.

```sql
CREATE MATERIALIZED VIEW events_daily_mv TO events_daily
AS SELECT
    toDate(timestamp) AS day,
    count() AS events,
    uniqState(user_id) AS unique_users
FROM events
GROUP BY day;
```

**Best for:**
- Real-time aggregations from a single source table
- Simple transformations (filtering, parsing, type conversion)
- When freshness measured in seconds matters

**Limitations:**
- JOINs only trigger on the left-most table (more on this later)
- Complex queries add latency to every insert
- No way to "catch up" if the MV logic changes

### Refreshable Materialized Views

Refreshable MVs re-execute their entire query on a schedule, replacing the target table contents. They work like PostgreSQL's `REFRESH MATERIALIZED VIEW`, but with scheduling built in.

```sql
CREATE MATERIALIZED VIEW hourly_report_mv
REFRESH EVERY 1 HOUR
TO hourly_report
AS SELECT
    toStartOfHour(timestamp) AS hour,
    source_table.metric,
    dimension_table.category
FROM source_table
JOIN dimension_table ON source_table.dim_id = dimension_table.id
GROUP BY hour, metric, category;
```

The `DEPENDS ON` clause enables DAG-like pipelines where one refreshable MV waits for another to complete:

```sql
CREATE MATERIALIZED VIEW daily_summary_mv
REFRESH EVERY 1 DAY
DEPENDS ON hourly_report_mv
TO daily_summary
AS SELECT
    toDate(hour) AS day,
    sum(metric) AS total
FROM hourly_report
GROUP BY day;
```

**Best for:**
- Complex JOINs across multiple tables
- Transformations where staleness (hourly/daily) is acceptable
- Batch workflows similar to dbt pipelines
- Cases where dimension tables change and need to be reflected

**Limitations:**
- Data is stale between refreshes
- Query must complete faster than refresh interval
- Full recomputation uses more resources than incremental

The [refreshable materialized views guide](/guides/refreshable-materialized-views) walks through creating, refreshing on demand, chaining with `DEPENDS ON`, `APPEND` mode and monitoring, with SQL that runs on the seed dataset. The [materialized view rollups example](/examples/materialized-view-rollups) runs an incremental and a refreshable view side by side over the same table.

### Decision Framework

| Requirement | Use This |
|-------------|----------|
| Real-time aggregates, single source table | Incremental MV |
| Complex JOINs that must reflect dimension changes | Refreshable MV |
| Sub-second freshness | Incremental MV |
| dbt-style batch pipelines | Refreshable MV |
| Hourly/daily rollups where slight staleness is OK | Either (refreshable is simpler) |

---

## The TO Clause: Production Code vs Prototypes

You can create materialized views with or without specifying a target table. Without the `TO` clause, ClickHouse creates a hidden `.inner.{mv_name}` table automatically:

```sql
-- Implicit target table (prototype pattern)
CREATE MATERIALIZED VIEW events_mv
ENGINE = SummingMergeTree()
ORDER BY day
AS SELECT toDate(timestamp) AS day, count() AS events
FROM events
GROUP BY day;
```

This works for quick experiments but creates problems in production. You can't easily inspect the hidden table's schema, can't attach multiple MVs to the same destination, and schema migrations require dropping and recreating both the MV and its data.

**The production pattern uses explicit target tables:**

```sql
-- Step 1: Create the target table with full control
CREATE TABLE events_daily (
    day Date,
    events UInt64,
    unique_users AggregateFunction(uniq, UInt64)
) ENGINE = AggregatingMergeTree()
ORDER BY day;

-- Step 2: Create the MV pointing to it
CREATE MATERIALIZED VIEW events_daily_mv TO events_daily
AS SELECT
    toDate(timestamp) AS day,
    count() AS events,
    uniqState(user_id) AS unique_users
FROM events
GROUP BY day;
```

**Why this matters:**

- **Schema migrations**: Alter the target table directly, then recreate only the MV definition (not the data)
- **Multiple writers**: Several MVs can write to the same target table
- **Visibility**: Query `events_daily` directly; no hidden `.inner.` tables to discover
- **Engine control**: Full control over partitioning, ORDER BY, TTL, and settings
- **Backups**: Standard table backup procedures work on the target

Note that `POPULATE` doesn't work with the `TO` syntax—you cannot use both together. This is actually a safety feature that forces you into the safer manual backfill pattern described below.

---

## Choosing the Right Table Engine

The target table's engine determines how ClickHouse handles aggregates over time. Choose wrong and your aggregates will be incorrect or your storage will explode.

### SummingMergeTree

Use when you only need SUM and COUNT aggregations with a fixed set of grouping dimensions.

```sql
CREATE TABLE daily_hits (
    day Date,
    page String,
    hits UInt64,
    bytes UInt64
) ENGINE = SummingMergeTree()
ORDER BY (day, page);

CREATE MATERIALIZED VIEW daily_hits_mv TO daily_hits
AS SELECT
    toDate(timestamp) AS day,
    page,
    count() AS hits,
    sum(response_bytes) AS bytes
FROM requests
GROUP BY day, page;
```

During background merges, rows with matching `(day, page)` keys are combined by summing `hits` and `bytes`.

**Critical rule: ORDER BY must exactly match your GROUP BY dimensions.** If they don't align, merges won't combine rows correctly:

```sql
-- WRONG: ORDER BY has 'region' but GROUP BY doesn't include it
CREATE TABLE broken (
    day Date,
    hits UInt64
) ENGINE = SummingMergeTree()
ORDER BY (day, region);  -- 'region' not in the MV's GROUP BY
```

### AggregatingMergeTree

Use when you need aggregations beyond simple sums: distinct counts, averages, min/max, percentiles, or multiple aggregate types in one row.

The pattern requires `-State` functions when inserting and `-Merge` functions when querying:

```sql
CREATE TABLE user_metrics (
    day Date,
    app String,
    sessions AggregateFunction(count, UInt64),
    unique_users AggregateFunction(uniq, UInt64),
    avg_duration AggregateFunction(avg, Float64),
    p95_latency AggregateFunction(quantile(0.95), Float64)
) ENGINE = AggregatingMergeTree()
ORDER BY (app, day);

CREATE MATERIALIZED VIEW user_metrics_mv TO user_metrics
AS SELECT
    toDate(timestamp) AS day,
    app,
    countState() AS sessions,
    uniqState(user_id) AS unique_users,
    avgState(duration_ms) AS avg_duration,
    quantileState(0.95)(latency_ms) AS p95_latency
FROM events
GROUP BY day, app;
```

Querying requires finalizing the aggregate states:

```sql
SELECT
    day,
    app,
    countMerge(sessions) AS sessions,
    uniqMerge(unique_users) AS unique_users,
    avgMerge(avg_duration) AS avg_duration,
    quantileMerge(0.95)(p95_latency) AS p95_latency
FROM user_metrics
WHERE day >= today() - 7
GROUP BY day, app;
```

**The GROUP BY in the query is essential.** Background merges happen asynchronously, so your table may contain multiple partial aggregate rows for the same key. The GROUP BY ensures they're combined at query time.

### SimpleAggregateFunction

For aggregations where the intermediate state equals the final value (sum, min, max, any), `SimpleAggregateFunction` uses 8 bytes instead of 24 bytes for the equivalent `AggregateFunction`. On large tables, this adds up.

```sql
CREATE TABLE metrics (
    day Date,
    device_id UInt64,
    max_temp SimpleAggregateFunction(max, Float32),
    min_temp SimpleAggregateFunction(min, Float32),
    total_readings SimpleAggregateFunction(sum, UInt64)
) ENGINE = AggregatingMergeTree()
ORDER BY (day, device_id);
```

You can query these columns directly without `-Merge` functions, but still need GROUP BY for correctness.

### Understanding Merge Timing

ClickHouse doesn't merge parts immediately—merges happen asynchronously when the system determines it's beneficial. This means:

```sql
-- Without GROUP BY, you might see unmerged duplicate rows
SELECT * FROM user_metrics WHERE day = today();
-- Could return multiple rows for same (day, app) before merge

-- Always use GROUP BY and -Merge functions for correct results
SELECT day, app, countMerge(sessions)
FROM user_metrics
WHERE day = today()
GROUP BY day, app;
```

The `FINAL` modifier forces merge logic at query time but has CPU overhead. Use it sparingly for exact results; prefer GROUP BY for analytical queries.

---

## Production Pitfalls

These are the mistakes that cause incidents. Every one of them has bitten production systems.

### POPULATE Will Lose Your Data

The `POPULATE` keyword tells ClickHouse to apply the MV to all existing data when created:

```sql
-- DON'T DO THIS ON PRODUCTION TABLES
CREATE MATERIALIZED VIEW events_mv
ENGINE = SummingMergeTree()
ORDER BY day
POPULATE  -- Dangerous
AS SELECT toDate(timestamp) AS day, count() AS events
FROM events
GROUP BY day;
```

**Why this fails:**

1. POPULATE runs synchronously and blocks until complete. On a 100GB table, this can take hours.
2. Any data inserted *during* POPULATE is **silently lost**. The MV is created after population finishes, so concurrent inserts fall into a gap.
3. Large POPULATEs can OOM your server.

**The safe backfill pattern:**

```sql
-- Step 1: Create target table
CREATE TABLE events_daily (
    day Date,
    events UInt64
) ENGINE = SummingMergeTree()
ORDER BY day;

-- Step 2: Create MV with a filter that excludes existing data
CREATE MATERIALIZED VIEW events_daily_mv TO events_daily
AS SELECT toDate(timestamp) AS day, count() AS events
FROM events
WHERE timestamp >= '2025-01-15 00:00:00'  -- Just after "now"
GROUP BY day;

-- Step 3: Manually backfill everything before that timestamp
INSERT INTO events_daily
SELECT toDate(timestamp) AS day, count() AS events
FROM events
WHERE timestamp < '2025-01-15 00:00:00'
GROUP BY day;

-- Step 4: Optionally remove the filter by recreating the MV
DROP VIEW events_daily_mv;
CREATE MATERIALIZED VIEW events_daily_mv TO events_daily
AS SELECT toDate(timestamp) AS day, count() AS events
FROM events
GROUP BY day;
```

For multi-terabyte backfills, batch by partition to avoid timeouts and memory pressure.

### Small Batch Ingestion Creates Part Explosion

Each INSERT creates at least one new part in every MV target table. With streaming ingestion sending thousands of tiny batches per minute, you'll hit this error:

```
DB::Exception: Too many parts (300) in all partitions in total
```

Merge pressure can't keep up with part creation, and ClickHouse refuses further inserts to protect itself.

**Solutions:**

- **Batch your inserts**: Minimum 1,000 rows per insert; optimal is 10,000–100,000
- **Use async inserts**: `async_insert=1` lets ClickHouse batch on the server side
- **Buffer tables**: Insert into a Buffer engine table that flushes periodically to the real table

### JOINs Only Trigger on the Left-Most Table

When your MV includes a JOIN, only inserts to the left table fire the view:

```sql
CREATE MATERIALIZED VIEW order_details_mv TO order_details
AS SELECT
    o.order_id,
    o.amount,
    c.customer_name,  -- Snapshot at insert time
    c.region          -- Will be stale if customers table changes
FROM orders o
LEFT JOIN customers c ON o.customer_id = c.id;
```

If you update a customer's region, existing MV records keep the old value forever. The MV has no visibility into changes to the right-side table.

**Solution: Use dictionaries instead of JOINs**

Dictionaries provide in-memory key-value lookups that refresh on a schedule:

```sql
CREATE DICTIONARY customer_dict (
    id UInt64,
    customer_name String,
    region String
) PRIMARY KEY id
SOURCE(CLICKHOUSE(TABLE 'customers'))
LAYOUT(HASHED())
LIFETIME(MIN 300 MAX 360);  -- Refresh every 5-6 minutes

CREATE MATERIALIZED VIEW order_details_mv TO order_details
AS SELECT
    order_id,
    amount,
    dictGet('customer_dict', 'customer_name', customer_id) AS customer_name,
    dictGet('customer_dict', 'region', customer_id) AS region
FROM orders;
```

Now dimension lookups happen at insert time using the latest dictionary values. Dictionary refreshes are independent of the MV.

For truly complex JOINs where dictionary lookups don't fit, use refreshable MVs that periodically recompute the full result.

### Wrong Engine for Aggregated Targets

Using plain MergeTree as the target for aggregating MVs is a common mistake:

```sql
-- WRONG: MergeTree doesn't merge aggregates
CREATE TABLE daily_stats (
    day Date,
    events UInt64
) ENGINE = MergeTree()  -- Should be SummingMergeTree
ORDER BY day;

CREATE MATERIALIZED VIEW daily_stats_mv TO daily_stats
AS SELECT toDate(timestamp) AS day, count() AS events
FROM events
GROUP BY day;
```

Each insert batch creates a new row. After 100 inserts, you have 100 rows for the same day that never combine. Your "aggregate" table grows linearly with insert count.

**Fix:** Use SummingMergeTree or AggregatingMergeTree for aggregate targets.

### High-Cardinality GROUP BY

If your grouping key is too granular, the "aggregated" table can be larger than the source.

Real example: A 20GB raw events table produced a 190GB MV because the GROUP BY included `(timestamp, user_id, session_id, page, referrer)` — nearly as many unique combinations as raw rows.

**Check your aggregation ratio before creating an MV:**

```sql
SELECT
    count() AS total_rows,
    uniq(tuple(day, app, page)) AS unique_groups,
    round(unique_groups / total_rows * 100, 2) AS aggregation_ratio_pct
FROM events;
```

- **< 10%**: Good compression, MV will be much smaller than source
- **10-50%**: Moderate benefit, evaluate if worth the overhead
- **> 70%**: Dangerous—you're likely to increase storage

### Memory Pressure from Complex MVs

JOINs in MVs are particularly dangerous because the right-side table is scanned on every insert. One team reported 50GB+ memory usage from JOIN-based MVs that dropped to 3.5GB after switching to dictionaries.

For heavy aggregations (large GROUP BYs, quantiles, distinct counts), configure memory limits:

```sql
SET max_bytes_before_external_group_by = 10000000000;  -- Spill to disk at 10GB
```

---

## Materialized Views vs Projections

Projections are an alternative that solves a narrower problem: storing the same data in multiple sort orders within a single table.

```sql
-- Add a projection for queries filtering by user_id
ALTER TABLE events ADD PROJECTION events_by_user (
    SELECT * ORDER BY (user_id, timestamp)
);

ALTER TABLE events MATERIALIZE PROJECTION events_by_user;
```

The query optimizer automatically chooses the projection when it would be faster. No query changes required.

**When projections win:**

- You need different sort orders for the same table
- You want transparent optimization (queries don't change)
- Atomic consistency with the base table matters
- Simpler operational model (no separate target tables)

**When MVs win:**

- Cross-table transformations or JOINs
- Complex aggregation states (uniq, quantiles)
- Multi-stage pipelines
- Different schema than source (filtering, parsing, type changes)
- ETL-style workflows

**Rule of thumb:** If you're thinking "same data, different sort order or simple aggregates," try a projection. If you're thinking "transform, aggregate across tables, or pipeline," use an MV.

---

## Tiered Aggregation: The Production Pattern

At scale, teams like Cloudflare, PostHog, and GitLab use tiered aggregation: raw data flows into MVs that produce hourly aggregates, which feed into daily aggregates. Each tier stores mergeable intermediate states.

```sql
-- Tier 1: Raw events → Hourly rollup
CREATE TABLE events_hourly (
    hour DateTime,
    app String,
    events AggregateFunction(count, UInt64),
    unique_users AggregateFunction(uniq, UInt64),
    total_bytes AggregateFunction(sum, UInt64)
) ENGINE = AggregatingMergeTree()
ORDER BY (app, hour);

CREATE MATERIALIZED VIEW events_hourly_mv TO events_hourly
AS SELECT
    toStartOfHour(timestamp) AS hour,
    app,
    countState() AS events,
    uniqState(user_id) AS unique_users,
    sumState(bytes) AS total_bytes
FROM events_raw
GROUP BY hour, app;

-- Tier 2: Hourly → Daily rollup
-- Note: uses -MergeState to combine existing states, not -State
CREATE TABLE events_daily (
    day Date,
    app String,
    events AggregateFunction(count, UInt64),
    unique_users AggregateFunction(uniq, UInt64),
    total_bytes AggregateFunction(sum, UInt64)
) ENGINE = AggregatingMergeTree()
ORDER BY (app, day);

CREATE MATERIALIZED VIEW events_daily_mv TO events_daily
AS SELECT
    toDate(hour) AS day,
    app,
    countMergeState(events) AS events,
    uniqMergeState(unique_users) AS unique_users,
    sumMergeState(total_bytes) AS total_bytes
FROM events_hourly
GROUP BY day, app;
```

**Why this works:**

- Each tier processes less data than the previous
- Aggregate states are mergeable across time periods (that's what `-MergeState` does)
- Queries can hit the appropriate tier based on time range
- Dashboard queries over the last 30 days read ~720 hourly rows instead of billions of raw events

**Querying across tiers:**

```sql
-- Last 7 days: hit daily table
SELECT day, app, countMerge(events), uniqMerge(unique_users)
FROM events_daily
WHERE day >= today() - 7
GROUP BY day, app;

-- Last 6 hours: hit hourly table
SELECT hour, app, countMerge(events), uniqMerge(unique_users)
FROM events_hourly
WHERE hour >= now() - INTERVAL 6 HOUR
GROUP BY hour, app;
```

---

## In TypeScript with hypequery

The target table is an ordinary table, so you can query it with any client. What a semantic layer adds is that the `-Merge` combinator, the `GROUP BY`, and the time bucketing stop being things every caller has to remember. With [`@hypequery/datasets`](/docs/datasets/overview), a dataset over the target declares how each column is read, and `measure.merge` applies the right `-Merge` function:

```typescript
import { dataset, dimension, divide, measure, nullIfZero } from '@hypequery/datasets';

export const EventsDaily = dataset('eventsDaily', {
  source: 'events_daily',
  timeKey: 'day',
  timeGrains: ['day', 'week', 'month', 'quarter', 'year'],
  dimensions: {
    day: dimension.timestamp(),
    tenantId: dimension.number({ column: 'tenant_id' }),
    eventType: dimension.string({ column: 'event_type' }),
  },
  measures: {
    events: measure.sum('events'),                      // SimpleAggregateFunction(sum)
    errors: measure.sum('errors'),
    uniqueUsers: measure.merge('uniqExact', 'users'),   // uniqExactMerge(users)
    errorRate: measure.derived({
      uses: { errors: 'errors', events: 'events' },
      formula: ({ errors, events }) => divide(errors, nullIfZero(events)),
    }),
  },
});
```

```typescript
import { createQueryBuilder } from '@hypequery/clickhouse';
import { createDatasetClient, between } from '@hypequery/datasets';

const db = createQueryBuilder({ url: process.env.CLICKHOUSE_URL!, database: 'hypequery_examples' });
const analytics = createDatasetClient({ queryBuilder: db });

const weekly = await analytics.execute(EventsDaily, {
  by: 'week',
  measures: ['events', 'uniqueUsers', 'errorRate'],
  filters: [between('day', '2026-08-01', '2026-10-31')],
});
```

Asking for `by: 'week'` merges seven days of `uniqExact` states into one exact weekly count, instead of adding up seven daily numbers. The same `analytics.execute` call works against the raw `events` table and against a refreshable target; only the dataset's `source` and the way uniques are read differ.

This is the [materialized view rollups example](/examples/materialized-view-rollups): an incremental view, a refreshable view, and three datasets over the seed, with a smoke test that proves both rollups match hand-written SQL over all one million rows. Scaffold it with:

```bash
npx hypequery create materialized-view-rollups -y
```

---

## Monitoring and Debugging

### system.query_views_log

This is your primary tool for MV observability. Enable it with `log_query_views=1` in your server config.

```sql
-- Find MV errors and slow performers
SELECT
    view_name,
    status,
    exception,
    count() AS executions,
    round(avg(view_duration_ms), 2) AS avg_duration_ms,
    max(view_duration_ms) AS max_duration_ms,
    formatReadableSize(max(peak_memory_usage)) AS max_memory
FROM system.query_views_log
WHERE event_time > now() - INTERVAL 1 HOUR
GROUP BY view_name, status, exception
ORDER BY avg_duration_ms DESC;
```

**Alert on:**
- Any non-zero `exception_code`
- `view_duration_ms` exceeding your insert latency budget (e.g., > 500ms)
- `peak_memory_usage` approaching configured limits

### Detecting Stale MVs

Compare modification times between source and target tables:

```sql
SELECT
    database,
    table,
    max(modification_time) AS last_modified,
    dateDiff('minute', max(modification_time), now()) AS minutes_since_update
FROM system.parts
WHERE active
  AND table IN ('events_raw', 'events_hourly', 'events_daily')
GROUP BY database, table
ORDER BY table;
```

If your source table was modified 2 minutes ago but the MV target was modified 30 minutes ago, something's wrong.

### Checking Table Sizes and Part Counts

```sql
-- Storage per table
SELECT
    table,
    formatReadableSize(sum(bytes_on_disk)) AS size,
    sum(rows) AS rows,
    count() AS parts
FROM system.parts
WHERE active
GROUP BY table
ORDER BY sum(bytes_on_disk) DESC;
```

Watch the `parts` count—if it's climbing toward 300 for any partition, you have a part explosion problem.

---

## When NOT to Use Materialized Views

MVs add complexity. Before creating one, verify it's actually needed.

### Query-Time Aggregation May Be Fast Enough

ClickHouse's columnar storage with vectorized execution makes many aggregations subsecond on hundreds of millions of rows. If a query runs under 5 seconds and executes fewer than 100 times per day, the operational overhead of an MV may not be justified.

```sql
-- Profile before adding an MV
SELECT
    query,
    query_duration_ms,
    read_rows,
    formatReadableSize(read_bytes) AS data_read
FROM system.query_log
WHERE query LIKE '%your_aggregation_pattern%'
  AND type = 'QueryFinish'
ORDER BY event_time DESC
LIMIT 20;
```

### High-Cardinality Aggregations Don't Help

If your GROUP BY produces nearly as many rows as the source, you've added insert overhead without meaningful query benefit. Check the aggregation ratio first.

### UPDATE/DELETE Workflows

MVs are fundamentally append-only. If your source data needs corrections:

- **Option 1**: Use ReplacingMergeTree for the source and query with FINAL
- **Option 2**: Use refreshable MVs that periodically rebuild from corrected source data
- **Option 3**: Handle mutations in your ETL before loading into ClickHouse

### When a Projection Would Suffice

If you just need a different sort order on the same table with no transformation, a projection is simpler:

```sql
-- Instead of an MV that copies data to a differently-sorted table
ALTER TABLE events ADD PROJECTION events_by_user (
    SELECT * ORDER BY (user_id, timestamp)
);
```

Projections maintain atomic consistency, require no target table management, and the optimizer uses them transparently.

### Insert Latency Is Critical

Each MV adds synchronous processing to every insert. If your application requires single-digit millisecond insert latency and you have complex MVs, you may need to:

- Move aggregation to async processing outside ClickHouse
- Use Buffer tables to decouple insert latency from MV processing
- Accept that MVs aren't the right tool for this workload

---

## FAQ

### What is a materialized view in ClickHouse?

An insert trigger. When rows are inserted into the source table, ClickHouse runs the view's `SELECT` over just those rows and inserts the result into a target table. You query the target. It does not read the source table's history, and it does not react to `UPDATE` or `DELETE`.

### What is the difference between a view and a materialized view in ClickHouse?

A view stores only the query and runs it on every `SELECT`. A materialized view stores results in a physical table, computed at insert time (incremental) or on a schedule (refreshable). Views are always current and cost nothing to maintain; materialized views trade freshness and insert overhead for much faster reads.

### Incremental or refreshable: which one should I use?

Incremental when freshness matters and the query reads one source table with simple aggregation. Refreshable when the query needs `JOIN`s, exact percentiles, top-N, or anything you want to recompute wholesale, and staleness of minutes or hours is fine. Many teams run both over the same facts.

### How do I backfill a materialized view?

Insert the view's `SELECT` over the historical rows straight into the target table (`INSERT INTO target SELECT ... FROM source GROUP BY ...`), batching by partition for large tables. Do not use `POPULATE`: it blocks, it cannot be used with `TO`, and rows inserted while it runs are silently lost.

### Does a materialized view update when I delete or update source rows?

No. Incremental views only see inserts. To reflect corrections, use `ReplacingMergeTree` with `FINAL` on the source, rebuild the target with a refreshable view, or fix the data before it reaches ClickHouse.

### How do I list all materialized views?

`SELECT name FROM system.tables WHERE engine = 'MaterializedView'`, and `SHOW CREATE TABLE <view>` for one definition. Refreshable views also report schedule and status in `system.view_refreshes`.

### Can a materialized view have a JOIN?

Yes, but an incremental view only fires on inserts to the left-most table and snapshots the right side at insert time. Use a dictionary (`dictGet`) for dimension lookups, or a refreshable view when the join result must track changes.

### Why does my aggregated table have duplicate rows?

Each insert block writes its own partial rows; background merges combine them later. Always query with `GROUP BY` and `-Merge` functions (or `FINAL`), and make sure the target engine is `AggregatingMergeTree` or `SummingMergeTree`, not plain `MergeTree`.

---

## Conclusion

Materialized views in ClickHouse are powerful precisely because they're minimal—they're insert triggers that transform data one block at a time, not magic caches that maintain themselves. This design enables petabyte-scale pre-aggregation but demands understanding of the trade-offs.

**The production-ready patterns:**

- Always use the **TO clause** with explicit target tables
- **Never use POPULATE** on tables larger than a few million rows
- Choose **AggregatingMergeTree with state functions** for complex aggregations
- Use **dictionaries instead of JOINs** for dimension lookups
- **Batch inserts** to at least 1,000 rows
- Monitor with **system.query_views_log**

**Before creating an MV, ask:**

- Would a projection suffice?
- Is query-time aggregation actually fast enough?
- What's the aggregation ratio—will this shrink or explode storage?
- Can we absorb the insert overhead?
- How will we handle schema changes and backfills?

**Go deeper:** the [refreshable materialized views guide](/guides/refreshable-materialized-views) covers scheduling, `DEPENDS ON`, `APPEND` and monitoring; the [materialized view rollups example](/examples/materialized-view-rollups) runs both kinds side by side with a typed dataset; and the function pages for [`count`](/clickhouse/functions/count), [`uniq`](/clickhouse/functions/uniq) and [`toStartOfDay`](/clickhouse/functions/to-start-of-day) cover the building blocks.

The teams running ClickHouse at scale don't use MVs everywhere. They use them strategically for specific query patterns where pre-aggregation provides order-of-magnitude improvements worth the insert overhead and operational complexity. That selective application, grounded in understanding how MVs actually work, is what separates production-ready implementations from prototype code.
