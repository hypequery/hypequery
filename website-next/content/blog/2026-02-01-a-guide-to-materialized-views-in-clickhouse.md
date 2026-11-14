---
title: "ClickHouse Materialized Views: How They Work, With Examples"
description: "A ClickHouse materialized view is an insert trigger: it runs its SELECT on each block of inserted rows and writes the result to a target table. How incremental and refreshable views differ, how to create and backfill one, which engine to use, and the mistakes that cause wrong numbers."
seoTitle: "ClickHouse Materialized Views: How They Work, With Examples"
seoDescription: "A ClickHouse materialized view runs its SELECT on each insert and writes to a target table. Incremental vs refreshable, how to refresh, backfills, engines."
pubDate: 2026-01-11
updatedAt: 2026-11-14
heroImage: ""
slug: a-guide-to-materialized-views-in-clickhouse
status: published
tags:
  - ClickHouse
  - Materialized views
---

A ClickHouse materialized view is an insert trigger. When rows are inserted into the source table, ClickHouse runs the view's `SELECT` on just those rows and writes the result into a target table; it never re-reads older data, and it doesn't react to updates or deletes. If you need the whole result recomputed on a schedule instead, use a refreshable materialized view (`REFRESH EVERY 1 HOUR`).

Every query on this page was run on ClickHouse 26.6.

## Quick answers

### What is a materialized view in ClickHouse?

A `SELECT` attached to a source table that runs on every inserted block and appends its output to a target table. Reads go to the target table, so they are fast.

### Does a materialized view see UPDATE and DELETE?

No. The ClickHouse docs say changes to existing source data (update, delete, drop partition) do not change the materialized view. Only inserts trigger it.

### Does a new materialized view include the rows already in the table?

No. It only processes rows inserted after it is created. You backfill the existing rows yourself, covered [below](#backfill-existing-data) and in the [create and backfill guide](/blog/clickhouse-create-materialized-view-to-table-backfill).

### Incremental or refreshable?

Incremental views keep a target up to date within seconds and suit single-table aggregations. Refreshable views rerun the full query on a schedule and suit joins and dimension changes. See [refreshable materialized views](/blog/clickhouse-refreshable-materialized-views).

### How do I refresh a materialized view?

A refreshable view reruns on its schedule, or now with `SYSTEM REFRESH VIEW name`. An incremental view has no refresh command: it is already current for every insert, and to recompute it you truncate the target and reload it with `INSERT ... SELECT`. Both are covered in [how to refresh a materialized view](#how-to-refresh-a-materialized-view).

### How do I drop a materialized view?

`DROP VIEW IF EXISTS events_daily_mv` (`DROP TABLE` works on views too). If the view writes `TO` a target table, the target and its rows stay; if it uses an implicit `.inner_id` table, dropping the view deletes that data. Drop the view before its target, or inserts into the source table start failing. See [show, list and drop materialized views](/blog/clickhouse-create-materialized-view-to-table-backfill#how-do-you-show-list-and-drop-materialized-views).

### How do I change or replace a materialized view?

`ALTER TABLE events_daily_mv MODIFY QUERY SELECT ...` swaps the query, and `CREATE OR REPLACE MATERIALIZED VIEW events_daily_mv TO events_daily AS SELECT ...` replaces the whole definition in one statement. With `TO`, neither touches rows already in the target; both apply only to future inserts. `CREATE OR REPLACE MATERIALIZED VIEW` needs a 26.x server: on 25.8 LTS it is a syntax error, so use `MODIFY QUERY` there. See [changing a materialized view](/blog/clickhouse-create-materialized-view-to-table-backfill).

### Materialized view or projection?

A projection stores another sort order or a pre-aggregation inside the same table's parts and is picked automatically by the optimizer. A materialized view writes to a separate table and can transform, filter or join. See [projections vs materialized views](/blog/clickhouse-projections-vs-materialized-views).

### View or materialized view?

A normal view stores only the query and runs it at read time; a materialized view stores data. See [view vs materialized view](/blog/clickhouse-view-vs-materialized-view).

## Incremental materialized views: how they work

An incremental materialized view is the default kind: any `CREATE MATERIALIZED VIEW` without a `REFRESH` clause. It processes each inserted block on its own. Insert 10,000 rows and the view's `SELECT` runs over those 10,000 rows, then the result is inserted into the target table:

```text
INSERT INTO events (one block of rows)
        ↓
the view's SELECT runs over that block only
        ↓
INSERT INTO events_daily (the aggregated rows for that block)
        ↓
queries read events_daily
```

Two consequences follow from this.

First, each insert produces its own partial result. Two inserts that touch the same day produce two rows for that day in the target until a background merge combines them. In our check, two inserts into a raw table left 13 rows in an hourly target that covered 9 distinct hours. That's why you always aggregate again when you read the target (`GROUP BY` with `-Merge` functions, shown below).

Second, the view's work is part of the insert. A slow `SELECT` in the view makes every insert into the source table slower, and each extra view on the same source adds to it.

## Create a materialized view with a TO table

Create the target table first, then point the view at it with `TO`. This keeps the target an ordinary table you can query, alter and back up:

```sql
CREATE TABLE events
(
    timestamp DateTime,
    app String,
    user_id UInt64,
    bytes UInt64
)
ENGINE = MergeTree
ORDER BY timestamp;

CREATE TABLE events_daily
(
    day Date,
    app String,
    events AggregateFunction(count),
    unique_users AggregateFunction(uniq, UInt64),
    total_bytes AggregateFunction(sum, UInt64)
)
ENGINE = AggregatingMergeTree
ORDER BY (app, day);

CREATE MATERIALIZED VIEW events_daily_mv TO events_daily AS
SELECT
    toDate(timestamp) AS day,
    app,
    countState() AS events,
    uniqState(user_id) AS unique_users,
    sumState(bytes) AS total_bytes
FROM events
GROUP BY day, app;
```

Read it back by merging the stored states:

```sql
SELECT
    day,
    app,
    countMerge(events) AS events,
    uniqMerge(unique_users) AS unique_users,
    sumMerge(total_bytes) AS total_bytes
FROM events_daily
GROUP BY day, app
ORDER BY day;
```

Without `TO`, ClickHouse creates a hidden inner table for the view, which is harder to inspect and can't be shared by several views. On ClickHouse 26.6, `TO` also rules out `POPULATE`; the server rejects the combination (26.8 lifts this, see below):

```text
When creating a materialized view you can't declare both 'TO [db].[table]' and 'POPULATE'. (SYNTAX_ERROR)
```

The [create and backfill guide](/blog/clickhouse-create-materialized-view-to-table-backfill) covers `CREATE OR REPLACE`, `ALTER ... MODIFY QUERY`, `DROP` and `SHOW` for materialized views.

## Backfill existing data

A new view only sees rows inserted after it exists, so backfill the old rows with an `INSERT ... SELECT` that uses the same query. To avoid counting rows twice, give the view and the backfill the same cutoff:

```sql
-- 1. The view only handles rows from the cutoff onwards
CREATE MATERIALIZED VIEW events_daily_mv TO events_daily AS
SELECT toDate(timestamp) AS day, app, countState() AS events,
       uniqState(user_id) AS unique_users, sumState(bytes) AS total_bytes
FROM events
WHERE timestamp >= '2026-11-08 00:00:00'
GROUP BY day, app;

-- 2. Backfill everything before the cutoff
INSERT INTO events_daily
SELECT toDate(timestamp) AS day, app, countState() AS events,
       uniqState(user_id) AS unique_users, sumState(bytes) AS total_bytes
FROM events
WHERE timestamp < '2026-11-08 00:00:00'
GROUP BY day, app;
```

The order matters. Set the cutoff a few minutes in the future, create the view, wait until the cutoff time has passed, and only then run the backfill. Rows inserted before the cutoff are then picked up by the backfill and rows from the cutoff onwards by the view. In our check, with rows arriving before the view, between the view and the cutoff, and after the cutoff, the target matched the source exactly (2,360 rows each). Running the backfill before the cutoff has passed loses the rows inserted in between. This assumes `timestamp` roughly tracks insert time: a row inserted after the backfill with a timestamp before the cutoff is filtered out by the view. For large tables, run the backfill one partition or one month at a time.

What about `POPULATE`? On ClickHouse 26.6 it can't be used with `TO`, and rows inserted while it runs can be missed. The [ClickHouse 26.8 release](https://clickhouse.com/blog/clickhouse-release-26-08) fixed that race with an atomic `POPULATE` (setting `materialized_views_populate_atomically`, on by default) and allowed `POPULATE` together with `TO`; the docs note the guarantee covers inserts arriving through the same server, not other replicas. To see which behaviour your server has:

```sql
SELECT name, value FROM system.settings
WHERE name = 'materialized_views_populate_atomically';
```

No row means your version predates the fix. The `TO` table plus cutoff backfill works on every version, and the [create and backfill guide](/blog/clickhouse-create-materialized-view-to-table-backfill) covers backfilling large tables in slices.

## Refreshable materialized views

A refreshable materialized view adds a `REFRESH` clause. Instead of reacting to inserts, it reruns its whole `SELECT` on a schedule and swaps the result into the target table atomically, so readers never see a half-written table:

```sql
CREATE TABLE customers (id UInt64, region String)
ENGINE = MergeTree ORDER BY id;

CREATE TABLE orders (order_id UInt64, customer_id UInt64, amount Decimal(18, 2))
ENGINE = MergeTree ORDER BY order_id;

CREATE TABLE revenue_by_region (region String, revenue Decimal(38, 2))
ENGINE = MergeTree ORDER BY region;

CREATE MATERIALIZED VIEW revenue_by_region_mv
REFRESH EVERY 1 HOUR
TO revenue_by_region AS
SELECT c.region AS region, sum(o.amount) AS revenue
FROM orders AS o
JOIN customers AS c ON o.customer_id = c.id
GROUP BY region;
```

What to know before using one:

- **Schedule.** `REFRESH EVERY 1 HOUR` runs on fixed boundaries (the top of each hour). `REFRESH AFTER 10 MINUTE` waits 10 minutes after the previous refresh finishes. Both run once as soon as the view is created.
- **Replace or append.** By default each refresh replaces the target's contents. Add `APPEND` (`REFRESH AFTER 10 MINUTE APPEND TO snapshots`) to insert the new rows next to the old ones, which suits periodic snapshots.
- **Database engine.** Replace mode needs an Atomic or Replicated database. Atomic is the default for new databases.
- **No setting needed.** On ClickHouse 26.6, `allow_experimental_refreshable_materialized_view` is obsolete and does nothing.
- **Cost.** Every refresh reads everything the query reads, so keep the query bounded (a date filter, or a small source) or refresh less often.

`DEPENDS ON` chains one refreshable view after another, and `RANDOMIZE FOR` spreads refresh times out. The [refreshable views guide](/blog/clickhouse-refreshable-materialized-views) covers both.

## Incremental vs refreshable materialized views

Use an incremental view when the target must be current within seconds and the logic depends only on the inserted rows. Use a refreshable view when the result depends on other tables that change, or when the query is too heavy to run on every insert.

| | Incremental | Refreshable |
|---|---|---|
| Runs | On every insert into the source table | On a schedule (`REFRESH EVERY` / `AFTER`) or `SYSTEM REFRESH VIEW` |
| Reads | Only the inserted block | The full query, every time |
| Freshness | Seconds | As stale as the interval |
| Joins | Fire only on inserts into the left-most table; right-side changes are missed | Fine: each refresh sees current data |
| Database engine | Any | Atomic or Replicated (except `APPEND`) |

A refreshable view that joins a dimension table:

```sql
CREATE MATERIALIZED VIEW hourly_report_mv
REFRESH EVERY 1 HOUR
TO hourly_report AS
SELECT
    toStartOfHour(s.ts) AS hour,
    d.category AS category,
    sum(s.metric) AS total
FROM src AS s
JOIN dims AS d ON s.dim_id = d.id
GROUP BY hour, category;
```

When we changed a category in `dims` and ran `SYSTEM REFRESH VIEW hourly_report_mv`, the report showed the new category. An incremental view with the same join would have kept the old one. The [refreshable views guide](/blog/clickhouse-refreshable-materialized-views) covers `APPEND`, `DEPENDS ON` and `system.view_refreshes`.

## How to refresh a materialized view

What "refresh" means depends on the kind of view.

### Refresh a refreshable view now

`SYSTEM REFRESH VIEW` starts a refresh immediately, outside the schedule. `SYSTEM WAIT VIEW` blocks until it finishes, which is useful in scripts and tests:

```sql
SYSTEM REFRESH VIEW revenue_by_region_mv;
SYSTEM WAIT VIEW revenue_by_region_mv;
```

In our check, we moved a customer from `us` to `apac` in the `customers` table. `revenue_by_region` still showed `us` until we ran `SYSTEM REFRESH VIEW`, and showed `apac` right after.

The other commands you need for a refreshable view:

```sql
-- Pause and resume scheduled refreshes
SYSTEM STOP VIEW revenue_by_region_mv;
SYSTEM START VIEW revenue_by_region_mv;

-- Change the schedule without recreating the view
ALTER TABLE revenue_by_region_mv MODIFY REFRESH EVERY 30 MINUTE;

-- Status, last success and next run
SELECT view, status, last_success_time, next_refresh_time, exception
FROM system.view_refreshes;
```

`status` reads `Scheduled` between runs, `Running` during one and `Disabled` after `SYSTEM STOP VIEW`.

### Refresh an incremental view

An incremental view has no refresh command, because it updates on every insert. Running `SYSTEM REFRESH VIEW` on one fails with "Refreshable view ... doesn't exist", and `ALTER TABLE ... MODIFY REFRESH` fails with "Alter of type 'MODIFY_REFRESH' is not supported". You need a recompute when the target has drifted from the source: a retried insert counted twice, a bug in the view's query, or a source correction the view never saw.

If you can pause inserts into the source table, truncate the target and reload it with the view's own query. For the `events_daily` view from [the TO table example](#create-a-materialized-view-with-a-to-table), that means the same `-State` functions:

```sql
TRUNCATE TABLE events_daily;

INSERT INTO events_daily
SELECT toDate(timestamp) AS day, app, countState() AS events,
       uniqState(user_id) AS unique_users, sumState(bytes) AS total_bytes
FROM events
GROUP BY day, app;
```

In our check, a target that had drifted to 1,860 events per app went back to 1,500, matching the source, and the view kept writing new inserts afterwards. Rows inserted between the `TRUNCATE` and the end of the `INSERT ... SELECT` can be counted twice, which is why inserts should be paused. If they can't be, build a new target table and view with the [cutoff backfill](#backfill-existing-data), then move readers to the new table.

To change what the view computes, `ALTER TABLE events_daily_mv MODIFY QUERY SELECT ...` replaces its query. The new query applies only to future inserts, so recompute the existing rows as above.

If the target needs recomputing often, the logic probably belongs in a refreshable view.

## Which engine to use for the target table

The target engine decides how partial rows from different inserts get combined, so the wrong choice gives wrong totals.

### SummingMergeTree

SummingMergeTree adds up numeric columns for rows with the same sorting key. Use it when every metric is a sum or count:

```sql
CREATE TABLE daily_hits
(
    day Date,
    page String,
    hits UInt64
)
ENGINE = SummingMergeTree
ORDER BY (day, page);
```

The sorting key must contain every column you group by. In our check, a `SummingMergeTree` ordered by `day` only, fed by a view grouped by `(day, page)`, merged the hits for `/a` and `/b` into one row labelled `/b` with `hits = 3`. No error, just a wrong number.

### AggregatingMergeTree

AggregatingMergeTree stores aggregate states (`countState`, `uniqState`, `quantileState`, `avgState`) and merges them in the background. Use it for distinct counts, averages, quantiles or a mix. You write with `-State` functions and read with `-Merge` functions and a `GROUP BY`, as in the example above.

### SimpleAggregateFunction

SimpleAggregateFunction columns inside an `AggregatingMergeTree` hold plain values for functions like `sum`, `min`, `max` and `any`, which you can read without `-Merge`:

```sql
CREATE TABLE device_daily
(
    day Date,
    device_id UInt64,
    max_temp SimpleAggregateFunction(max, Float32),
    readings SimpleAggregateFunction(sum, UInt64)
)
ENGINE = AggregatingMergeTree
ORDER BY (day, device_id);
```

### Plain MergeTree

A plain MergeTree target never combines rows. In our check, two inserts into a view grouped by day produced two separate rows for the same day (1 and 2), even after `OPTIMIZE TABLE ... FINAL`. Use it only when the view filters or reshapes rows without aggregating.

## Tiered rollups: hourly to daily

At larger volumes, a common pattern feeds an hourly target from the raw table and a daily target from the hourly one. The second view combines existing states with `-MergeState`:

```sql
CREATE TABLE events_hourly
(
    hour DateTime,
    app String,
    events AggregateFunction(count),
    unique_users AggregateFunction(uniq, UInt64),
    total_bytes AggregateFunction(sum, UInt64)
)
ENGINE = AggregatingMergeTree
ORDER BY (app, hour);

CREATE MATERIALIZED VIEW events_hourly_mv TO events_hourly AS
SELECT toStartOfHour(timestamp) AS hour, app, countState() AS events,
       uniqState(user_id) AS unique_users, sumState(bytes) AS total_bytes
FROM events
GROUP BY hour, app;

CREATE TABLE events_daily_rollup
(
    day Date,
    app String,
    events AggregateFunction(count),
    unique_users AggregateFunction(uniq, UInt64),
    total_bytes AggregateFunction(sum, UInt64)
)
ENGINE = AggregatingMergeTree
ORDER BY (app, day);

CREATE MATERIALIZED VIEW events_daily_rollup_mv TO events_daily_rollup AS
SELECT toDate(hour) AS day, app, countMergeState(events) AS events,
       uniqMergeState(unique_users) AS unique_users, sumMergeState(total_bytes) AS total_bytes
FROM events_hourly
GROUP BY day, app;
```

Inserts into `events` cascade through both views. In our check, 700 raw rows over two inserts gave a daily row with 700 events, 11 unique users and 70,000 bytes, the same as aggregating the raw table directly.

## Query the target table from TypeScript and Python

Application code reads the target table, not the view, and it has to merge partial rows the same way the SQL above does. Every result below came from the `events_daily` example on ClickHouse 26.6 and matched the same aggregation run on the raw `events` table.

### TypeScript: the query builder

Declare only the columns you read directly. `AggregateFunction` columns are read through `-Merge` functions, so they go in `rawAs` expressions:

```ts
import { createQueryBuilder, rawAs } from '@hypequery/clickhouse';

type Schema = {
  events_daily: { day: 'Date'; app: 'String' };
};

const db = createQueryBuilder<Schema>({
  url: process.env.CLICKHOUSE_URL!,
  username: process.env.CLICKHOUSE_USERNAME!,
  password: process.env.CLICKHOUSE_PASSWORD!,
  database: process.env.CLICKHOUSE_DATABASE!,
});

export async function dailyUsage(app: string, from: string, to: string) {
  return db
    .table('events_daily')
    .select([
      'day',
      rawAs<string, 'events'>('countMerge(events)', 'events'),
      rawAs<string, 'unique_users'>('uniqMerge(unique_users)', 'unique_users'),
      rawAs<string, 'total_bytes'>('sumMerge(total_bytes)', 'total_bytes'),
    ])
    .where('app', 'eq', app)
    .where('day', 'gte', from)
    .where('day', 'lt', to)
    .groupBy('day')
    .orderBy('day', 'ASC')
    .execute();
}

// dailyUsage('web', '2026-11-02', '2026-11-05') returned:
// { day: '2026-11-03', events: '117', unique_users: '16', total_bytes: '62758' }, ...
```

The values arrive as strings because `countMerge`, `uniqMerge` and `sumMerge` over `UInt64` return 64-bit integers, which the client quotes in JSON so they don't lose precision.

### TypeScript: a dataset over the view's output

If several parts of the product read the same rollup, define it once as a dataset. `measure.merge` applies the matching `-Merge` function, so callers pick measures and dimensions and never write the combinator:

```ts
import { createQueryBuilder } from '@hypequery/clickhouse';
import { createDatasetClient, dataset, dimension, eq, measure } from '@hypequery/datasets';

const db = createQueryBuilder({
  url: process.env.CLICKHOUSE_URL!,
  username: process.env.CLICKHOUSE_USERNAME!,
  password: process.env.CLICKHOUSE_PASSWORD!,
  database: process.env.CLICKHOUSE_DATABASE!,
});

export const EventsDaily = dataset('eventsDaily', {
  source: 'events_daily',
  timeKey: 'day',
  dimensions: {
    day: dimension.timestamp(),
    app: dimension.string(),
  },
  measures: {
    events: measure.merge('count', 'events'),            // countMerge(events)
    uniqueUsers: measure.merge('uniq', 'unique_users'),  // uniqMerge(unique_users)
    totalBytes: measure.merge('sum', 'total_bytes'),     // sumMerge(total_bytes)
  },
});

const analytics = createDatasetClient({ queryBuilder: db });

const byApp = await analytics.execute(EventsDaily, {
  dimensions: ['app'],
  measures: ['events', 'uniqueUsers', 'totalBytes'],
  filters: [eq('app', 'web')],
});
// [{ app: 'web', events: '225', uniqueUsers: '29', totalBytes: '184330' }]
```

Because the states are merged, the distinct count stays correct at any grain: 29 users across all days, not the sum of each day's count. `measure.merge` shipped in `@hypequery/datasets` 0.29.0; the [measures docs](/docs/datasets/measures) list the supported state functions. The same dataset can then back an [HTTP API](/clickhouse-api), a [React hook](/clickhouse-react) or an [MCP tool](/clickhouse-mcp).

### Python

With a `SummingMergeTree` target, a dataset's `measure.sum` adds the partial rows up again at read time. For an `AggregatingMergeTree` target, send the `-Merge` query through clickhouse-connect with a bound parameter:

```python
import clickhouse_connect

from hypequery.datasets import DatasetQuery, create_dataset_client, dataset, dimension, filter, measure
from hypequery.execution import ClickHouseConnection, create_clickhouse_executor

# CREATE TABLE app_daily (day Date, app String, events UInt64, bytes UInt64)
# ENGINE = SummingMergeTree ORDER BY (app, day), filled by a materialized view
app_daily = dataset(
    "appDaily",
    source="app_daily",
    time_key="day",
    dimensions={
        "day": dimension.timestamp(),
        "app": dimension.string(),
    },
    measures={
        "events": measure.sum("events"),
        "bytes": measure.sum("bytes"),
    },
)

with create_clickhouse_executor(ClickHouseConnection.from_env()) as executor:
    analytics = create_dataset_client(executor=executor)
    result = analytics.execute(
        app_daily,
        DatasetQuery(
            dimensions=("app",),
            measures=("events", "bytes"),
            filters=(filter.eq("app", "web"),),
        ),
    )
    print(result.data)  # ({'app': 'web', 'events': 225, 'bytes': 184330},)

# The AggregatingMergeTree target from earlier
client = clickhouse_connect.get_client(host="localhost", port=8123)
rows = client.query(
    """
    SELECT day, countMerge(events) AS events, uniqMerge(unique_users) AS unique_users
    FROM events_daily
    WHERE app = {app:String}
    GROUP BY day
    ORDER BY day
    LIMIT 3
    """,
    parameters={"app": "web"},
).result_rows
# [(date(2026, 11, 1), 12, 12), (date(2026, 11, 2), 12, 12), (date(2026, 11, 3), 117, 16)]
```

This ran on hypequery 0.1.0b3 and clickhouse-connect 1.12.0. `ClickHouseConnection.from_env()` reads `CLICKHOUSE_URL`, or the separate host, user and database variables, but not both. The Python `measure.merge("uniq", "users")`, which works like the TypeScript one, is in the SDK source and not yet in 0.1.0b3 on PyPI. See [ClickHouse with Python](/clickhouse-python) for how the Python clients compare.

## Common mistakes

### Too many small inserts

Every insert creates a new part in the source table and in every target table. On ClickHouse 26.6, inserts start being delayed at 1,000 active parts in a partition (`parts_to_delay_insert`) and fail at 3,000 (`parts_to_throw_insert`) with a "Too many parts" error. Batch inserts into thousands of rows, or enable asynchronous inserts (`async_insert = 1`) so the server batches small inserts for you.

### Expecting joins to stay current

An incremental view with a join fires only on inserts into the left-most table, and it copies whatever the right-hand table held at that moment. In our check, a view joining `orders` to `customers` kept the region `eu` after the customer's region was updated to `apac`. If dimensions change, look them up with a dictionary (`dictGet`) at insert time, or use a refreshable view.

### Grouping by too many columns

If the `GROUP BY` has almost as many distinct combinations as the source has rows, the target will be about as big as the source and every insert pays for it. Check before creating the view:

```sql
SELECT
    count() AS total_rows,
    uniq(app, toDate(timestamp)) AS groups,
    round(groups / total_rows * 100, 2) AS groups_pct
FROM events;
```

### Assuming a failed view leaves things consistent

The docs say materialized views are not deterministic when errors happen: blocks already written to the target stay there, later blocks don't. By default an exception in a view fails the `INSERT`, so retries can double-count rows that reached the target before the error. Test schema changes to target tables before running them in production.

## Monitor materialized views

`system.query_views_log` records each view run, with its duration, rows written, memory use and any exception. It needs the `query_views_log` section in the server config, and `log_query_views` (1 by default on 26.6):

```sql
SELECT
    view_name,
    status,
    exception,
    count() AS runs,
    round(avg(view_duration_ms), 1) AS avg_ms,
    max(peak_memory_usage) AS max_memory_bytes
FROM system.query_views_log
WHERE event_time > now() - INTERVAL 1 HOUR
GROUP BY view_name, status, exception
ORDER BY avg_ms DESC;
```

Watch part counts on target tables too:

```sql
SELECT table, partition, count() AS parts, sum(rows) AS rows
FROM system.parts
WHERE active AND table IN ('events', 'events_daily')
GROUP BY table, partition
ORDER BY parts DESC;
```

`SHOW CREATE TABLE events_daily_mv` prints the view's current definition.

## When not to use a materialized view

Skip the view when the raw query is already fast enough for how often it runs. ClickHouse aggregates hundreds of millions of rows quickly, so measure with `system.query_log` first. Skip it when the grouping columns change often, because each change means a new view and a backfill. If you only need the same rows in a different sort order, a [projection](/blog/clickhouse-projections-vs-materialized-views) is simpler. If source rows get corrected after insert, consider `ReplacingMergeTree` with [`FINAL`](/blog/clickhouse-final-replacingmergetree-typescript) or a refreshable view.

## Related

- [Refreshable materialized views in ClickHouse](/blog/clickhouse-refreshable-materialized-views): `REFRESH EVERY`, `APPEND`, `DEPENDS ON` and monitoring
- [Create a materialized view with a TO table and backfill it](/blog/clickhouse-create-materialized-view-to-table-backfill)
- [Projections vs materialized views](/blog/clickhouse-projections-vs-materialized-views)
- Runnable versions: [incremental vs refreshable rollups](/examples/materialized-view-rollups) and [refreshable materialized views end to end](/guides/refreshable-materialized-views)
- [View vs materialized view in ClickHouse](/blog/clickhouse-view-vs-materialized-view)
- [Real-time analytics on ClickHouse](/clickhouse-real-time-analytics)
- [ClickHouse with TypeScript](/clickhouse-typescript) and [ClickHouse with Python](/clickhouse-python)
- [Semantic layer for ClickHouse](/clickhouse-semantic-layer): define rollup metrics once
- [Dataset measures, including `measure.merge`](/docs/datasets/measures)
- ClickHouse docs: [CREATE VIEW](https://clickhouse.com/docs/sql-reference/statements/create/view), [refreshable materialized views](https://clickhouse.com/docs/materialized-view/refreshable-materialized-view), [system.query_views_log](https://clickhouse.com/docs/operations/system-tables/query_views_log)
