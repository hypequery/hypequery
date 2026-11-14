---
title: "How to Create a Materialized View in ClickHouse: TO Table, POPULATE and Backfill"
description: "Create an incremental materialized view in ClickHouse the production way: CREATE MATERIALIZED VIEW ... TO a target table, backfill existing rows safely with a cutoff, avoid POPULATE's gaps, and change, list or drop views. Every query checked on ClickHouse 26.6."
seoTitle: "ClickHouse Create Materialized View: TO Table and Backfill"
seoDescription: "Create the target table, then CREATE MATERIALIZED VIEW ... TO it. The view only sees new inserts, so backfill old rows with INSERT ... SELECT and a cutoff."
pubDate: 2026-11-08
updatedAt: 2026-11-14
heroImage: ""
slug: clickhouse-create-materialized-view-to-table-backfill
status: published
tags:
  - ClickHouse
  - Materialized Views
---

To create a materialized view in ClickHouse, create the target table first, then run `CREATE MATERIALIZED VIEW view_name TO target_table AS SELECT ... FROM source_table`. From then on, every insert into the source table runs the `SELECT` on the inserted rows and writes the result to the target. Rows that were in the source before the view existed are not processed, so you backfill them yourself with `INSERT INTO target_table SELECT ...` bounded by a cutoff time, because `POPULATE` can miss rows inserted while it runs on ClickHouse 26.6.

For the mental model and the wider list of pitfalls, read the main [guide to materialized views in ClickHouse](/blog/a-guide-to-materialized-views-in-clickhouse); for scheduled views, see [refreshable materialized views](/blog/clickhouse-refreshable-materialized-views). Every statement below was run on ClickHouse 26.6.

## How do you create a materialized view in ClickHouse?

Create a target table with the columns and engine you want, then create the view with `TO` pointing at it. Match the `SELECT` aliases to the target's column names: on 26.6 a `SELECT` column with no matching target column fails the `CREATE` with `THERE_IS_NO_COLUMN`, and target columns the `SELECT` leaves out get their default values.

```sql
CREATE TABLE page_events
(
    ts DateTime,
    user_id UInt32,
    page String,
    duration_ms UInt32
)
ENGINE = MergeTree
ORDER BY (page, ts);

INSERT INTO page_events VALUES
    ('2026-11-06 09:15:00', 1, '/', 120),
    ('2026-11-06 10:02:00', 2, '/', 340),
    ('2026-11-07 14:30:00', 1, '/pricing', 90),
    ('2026-11-08 08:45:00', 3, '/', 200);

CREATE TABLE page_views_daily
(
    day Date,
    page String,
    views UInt64
)
ENGINE = SummingMergeTree
ORDER BY (day, page);

CREATE MATERIALIZED VIEW page_views_daily_mv
TO page_views_daily
AS SELECT toDate(ts) AS day, page, count() AS views
FROM page_events
GROUP BY day, page;

SELECT count() FROM page_views_daily;
```

```text
0
```

The four existing events are not in the target. Now insert one more:

```sql
INSERT INTO page_events VALUES ('2026-11-08 17:00:00', 4, '/pricing', 60);

SELECT day, page, views FROM page_views_daily ORDER BY day, page;
```

```text
2026-11-08  /pricing  1
```

Only the row inserted after `CREATE MATERIALIZED VIEW` reached the target. The [CREATE VIEW reference](https://clickhouse.com/docs/reference/statements/create/view) describes materialized views as working more like insert triggers: they transform each inserted block, and changes to existing source data (updates, deletes, dropped partitions) do not change the view.

## Why use TO instead of the implicit .inner table?

Without `TO`, you must give the view an `ENGINE`, and ClickHouse stores the result in a hidden table that it owns. In an Atomic database the hidden table is named `.inner_id.<uuid>`:

```sql
CREATE MATERIALIZED VIEW daily_inner_mv
ENGINE = SummingMergeTree
ORDER BY day
AS SELECT toDate(ts) AS day, count() AS views
FROM page_events
GROUP BY day;

SELECT name, engine FROM system.tables WHERE database = currentDatabase() ORDER BY name;
```

```text
.inner_id.9ba0e383-ea97-49bb-b488-353c293993fa  SummingMergeTree
daily_inner_mv                                  MaterializedView
page_events                                     MergeTree
page_views_daily                                SummingMergeTree
page_views_daily_mv                             MaterializedView
```

`DROP VIEW daily_inner_mv` removed both the view and the `.inner_id` table, and with it all the aggregated data. With `TO`, the view and the data are separate objects, which matters in practice:

| | `TO target_table` | Implicit `.inner_id` table |
|---|---|---|
| `DROP VIEW` | Drops the view; the target and its rows stay | Drops the view and its data |
| Recreate the view with a new query | Target data is kept | Data is lost unless you copy it first |
| Several views writing to one table | Yes; two views pointing `TO dst` both wrote rows | No, each view has its own inner table |
| Target schema and engine | A normal table you created and can `ALTER` | Defined in the view's `ENGINE` clause |
| `ALTER ... MODIFY QUERY` | Supported | The docs call its use "very limited" |

One thing to watch with `TO`: the target must exist for as long as the view does. After `DROP TABLE dst` with the view still attached, `INSERT INTO src VALUES (3)` failed with `Code: 60 ... Target table 'a.dst' of view ... doesn't exists. (UNKNOWN_TABLE)`, and the source row was not written either. Drop the view before its target.

## What does POPULATE do, and can it miss rows?

`POPULATE` runs the view's `SELECT` over the whole source table once at creation time and writes the result into the view. On ClickHouse 26.6 it has two limits that make it a poor fit for production tables.

First, it does not work with `TO`:

```sql
CREATE MATERIALIZED VIEW m TO dst POPULATE AS SELECT x FROM src;
```

```text
Code: 62. DB::Exception: When creating a materialized view you can't declare
both 'TO [db].[table]' and 'POPULATE'. (SYNTAX_ERROR)
```

Second, population is not atomic in 26.6. The ClickHouse [26.8 release post](https://clickhouse.com/blog/clickhouse-release-26-08) says a race condition caused `POPULATE` to skip records inserted during the population, and that 26.8 fixed it with a new setting, `materialized_views_populate_atomically`, on by default. The same release allowed `POPULATE` together with `TO`. The [backfilling guide](https://clickhouse.com/docs/guides/clickhouse/data-modelling/backfilling) still recommends `POPULATE` only for small datasets with ingest paused, since it runs over all the data in one query and can fail on interruptions or memory limits.

To find out which behaviour your server has, look for the setting:

```sql
SELECT name, value
FROM system.settings
WHERE name = 'materialized_views_populate_atomically';
```

On 26.6 this returns no rows, which means `POPULATE` can miss rows inserted while it runs. Even where the setting exists, the current CREATE VIEW reference says the guarantee only covers inserts that arrive at the same server, and that `POPULATE` is not supported in ClickHouse Cloud. The manual backfill below works on every version.

## How do you backfill a materialized view with existing data?

Pick a cutoff time a few minutes in the future, create the view with `WHERE ts >= cutoff`, wait until the cutoff has passed, then insert everything before the cutoff into the target yourself. The view handles rows at or after the cutoff and the backfill handles rows before it, so each row is counted once. This is the pattern in ClickHouse's [backfilling guide](https://clickhouse.com/docs/guides/clickhouse/data-modelling/backfilling).

Starting from the same four historical events, with a new empty `page_views_daily` and a cutoff of `2026-11-09 00:00:00`, first check that no existing rows are at or after the cutoff. The view will never see those rows and the backfill excludes them, so this query must return 0:

```sql
SELECT count() FROM page_events WHERE ts >= '2026-11-09 00:00:00';
```

Then create the view, let time pass the cutoff, and backfill:

```sql
CREATE MATERIALIZED VIEW page_views_daily_mv
TO page_views_daily
AS SELECT toDate(ts) AS day, page, count() AS views
FROM page_events
WHERE ts >= '2026-11-09 00:00:00'
GROUP BY day, page;

-- rows that arrive after the view exists but before the cutoff
INSERT INTO page_events VALUES
    ('2026-11-08 18:10:00', 5, '/', 80),
    ('2026-11-08 23:59:00', 8, '/pricing', 75);

-- rows after the cutoff: the view handles these
INSERT INTO page_events VALUES
    ('2026-11-09 00:05:00', 6, '/', 150),
    ('2026-11-09 07:30:00', 7, '/pricing', 400);

-- once the cutoff has passed: backfill everything before it
INSERT INTO page_views_daily
SELECT toDate(ts) AS day, page, count() AS views
FROM page_events
WHERE ts < '2026-11-09 00:00:00'
GROUP BY day, page;

SELECT
    (SELECT count() FROM page_events) AS raw_total,
    (SELECT sum(views) FROM page_views_daily) AS target_total;
```

```text
raw_total  target_total
8          8
```

All eight events are counted: four from before the view, two that arrived between creating the view and the cutoff, and two after it. The backfill query is the view's `SELECT` with the filter reversed.

The order matters. In a second run I did the backfill right after creating the view, before the cutoff had passed, and then inserted the same rows. The result was `raw_total 8, target_total 6`: the two events from 18:10 and 23:59 were older than the cutoff, so the view skipped them, and they did not exist yet when the backfill ran.

Running the backfill twice is the other way to get it wrong. A second identical `INSERT INTO page_views_daily SELECT ...` took `target_total` from 8 to 14 (six pre-cutoff events counted again), because `SummingMergeTree` adds the duplicate counts together. If a backfill slice fails partway, don't truncate the target: it also holds the rows the live view wrote. Delete only the failed slice's days and rerun that slice, for example `ALTER TABLE page_views_daily DELETE WHERE day = '2026-11-06'`. That is safe for days that end before the cutoff, because the view's filter means it never writes them; the day the cutoff falls on holds rows from both, so recompute it last, from the source, after the cutoff has passed. Alternatively, backfill into a separate staging table with the same schema and insert from it into the target once every slice has succeeded.

For large tables, run the backfill in slices (one day, or one partition, per statement) so that each statement reads less data and a failure only costs one slice:

```sql
INSERT INTO page_views_daily
SELECT toDate(ts) AS day, page, count() AS views
FROM page_events
WHERE ts >= '2026-11-06 00:00:00' AND ts < '2026-11-07 00:00:00'
GROUP BY day, page;
```

The backfilling guide also describes inserting the history into a table with the `Null` engine that has a copy of the view attached, so the view transforms it block by block the same way it handles live inserts, without storing the raw rows a second time.

This procedure assumes no rows older than the cutoff arrive while the backfill runs. A late row for 6 November that arrives after the 6 November slice has finished is skipped by the view, because of its filter, and missed by the slice, and changing the view afterwards does not bring it back. If your data can arrive late, either hold late ingestion until the backfill is done, or reconcile afterwards: for each day before the cutoff that may have received late rows, delete that day from the target and insert it again from the source. Once the backfill and any reconciliation are finished, remove the cutoff filter with `ALTER TABLE ... MODIFY QUERY` (covered below) so later late rows are counted.

## How do you aggregate with SummingMergeTree or AggregatingMergeTree?

Use `SummingMergeTree` when every metric is a sum or count, and `AggregatingMergeTree` with `-State` and `-Merge` functions for anything else (distinct counts, quantiles, averages). In both cases the view aggregates each insert separately, so the target holds one partial row per key per insert until a background merge combines them. Always aggregate again when you read.

In a fresh `page_views_daily`, two inserts into `page_events` for the same day and page (two events, then one) left two rows in the target:

```sql
SELECT day, page, views FROM page_views_daily ORDER BY views;
```

```text
2026-11-08  /  1
2026-11-08  /  2
```

```sql
SELECT day, page, sum(views) AS views FROM page_views_daily GROUP BY day, page;
```

```text
2026-11-08  /  3
```

For an `AggregatingMergeTree` target, declare `AggregateFunction` columns, write them with `-State` functions in the view, and read them with the matching `-Merge` functions:

```sql
CREATE TABLE page_stats_daily
(
    day Date,
    page String,
    views AggregateFunction(count),
    users AggregateFunction(uniq, UInt32),
    p95_ms AggregateFunction(quantile(0.95), UInt32)
)
ENGINE = AggregatingMergeTree
ORDER BY (day, page);

CREATE MATERIALIZED VIEW page_stats_daily_mv
TO page_stats_daily
AS SELECT
    toDate(ts) AS day,
    page,
    countState() AS views,
    uniqState(user_id) AS users,
    quantileState(0.95)(duration_ms) AS p95_ms
FROM page_events
WHERE ts >= '2026-11-09 00:00:00'
GROUP BY day, page;

SELECT
    day,
    page,
    countMerge(views) AS views,
    uniqMerge(users) AS users,
    round(quantileMerge(0.95)(p95_ms)) AS p95_ms
FROM page_stats_daily
GROUP BY day, page
ORDER BY day, page;
```

The backfill for this target must insert states too. Inserting a plain `count()` into an `AggregateFunction(count)` column fails with `Code: 70 ... Conversion from UInt64 to AggregateFunction(count) is not supported`. With the `-State` functions in the backfill `SELECT`, the same eight events as in the backfill section, and the backfill run one day at a time for 6, 7 and 8 November, the query above returned:

```text
2026-11-06  /         2  2  329
2026-11-07  /pricing  1  1  90
2026-11-08  /         2  2  194
2026-11-08  /pricing  1  1  75
2026-11-09  /         1  1  150
2026-11-09  /pricing  1  1  400
```

`countMerge(views)` over the whole target was 8, matching `count()` on `page_events`.

`countMerge` and `uniqMerge` return `UInt64`, and `quantileMerge` returns `Float64`.

## How do you alter or replace a materialized view?

To change the `SELECT` of a view that writes `TO` a table, use `ALTER TABLE view_name MODIFY QUERY`. To swap the whole definition in one statement, use `CREATE OR REPLACE MATERIALIZED VIEW`. Neither touches rows already in the target.

Adding a metric means changing the target first, then the view. Continuing from the two-insert example above (three events for `/` on 2026-11-08):

```sql
ALTER TABLE page_views_daily ADD COLUMN total_ms UInt64;

ALTER TABLE page_views_daily_mv MODIFY QUERY
SELECT toDate(ts) AS day, page, count() AS views, sum(duration_ms) AS total_ms
FROM page_events
GROUP BY day, page;

INSERT INTO page_events VALUES ('2026-11-08 11:00:00', 3, '/', 200);

SELECT day, page, sum(views) AS views, sum(total_ms) AS total_ms
FROM page_views_daily
GROUP BY day, page;
```

```text
2026-11-08  /  4  200
```

`views` covers all four events, but `total_ms` only covers the one inserted after the change: older rows got the column default, 0. If the old values matter, the new column needs its own backfill. On 26.6, `MODIFY QUERY` worked without changing any setting (`allow_experimental_alter_materialized_view_structure` is 1 and marked obsolete). The [ALTER VIEW reference](https://clickhouse.com/docs/reference/statements/alter/view) notes that it does not change the target table's structure, which is why the `ADD COLUMN` comes first.

`CREATE OR REPLACE` replaces the definition in one step:

```sql
CREATE OR REPLACE MATERIALIZED VIEW page_views_daily_mv
TO page_views_daily
AS SELECT toDate(ts) AS day, page, count() AS views
FROM page_events
WHERE page != '/health'
GROUP BY day, page;
```

Per the CREATE VIEW reference, `CREATE OR REPLACE MATERIALIZED VIEW` atomically replaces the view, and for a view without `TO` the old inner table is dropped and a new one created. With `TO`, only the definition changes and the target keeps its rows. `OR REPLACE` cannot be combined with `IF NOT EXISTS`.

Check your server version first: on ClickHouse 25.8 LTS (25.8.33.6), `CREATE OR REPLACE MATERIALIZED VIEW` is a syntax error (`Expected one of: TABLE, ... VIEW, DICTIONARY, ...`), while it works on 26.6 and 26.10. On 25.8, use `ALTER TABLE ... MODIFY QUERY`, which works there, or drop and recreate the view and backfill any rows inserted in between.

## How do you show, list and drop materialized views?

Materialized views appear in `SHOW TABLES` alongside ordinary tables; there is no `SHOW MATERIALIZED VIEWS` statement (it is a syntax error on 26.6). To list only views, filter `system.tables` by engine:

```sql
SELECT name, as_select
FROM system.tables
WHERE database = currentDatabase() AND engine = 'MaterializedView';
```

To find which views fire on inserts into a table, read the source table's `dependencies_table` column. With two views reading from `src`:

```sql
SELECT name, dependencies_table FROM system.tables WHERE name = 'src';
```

```text
src  ['mv2','mv1']
```

`SHOW CREATE TABLE page_views_daily_mv` and `SHOW CREATE VIEW page_views_daily_mv` both print the full definition, including the `TO` target and the column list.

To drop a view, use `DROP VIEW` (or `DROP TABLE`, which also works on views):

```sql
DROP VIEW IF EXISTS page_views_daily_mv;
```

With a `TO` target, `page_views_daily` and its rows were still there afterwards. Inserts into `page_events` stop flowing to it from that moment, so recreate the view (and backfill the gap) if you only meant to change it.

## Creating a materialized view ON CLUSTER

The CREATE VIEW syntax accepts `ON CLUSTER`: `CREATE MATERIALIZED VIEW [IF NOT EXISTS] [db.]table_name [ON CLUSTER cluster_name] [TO [db.]name] ...`. Per the [distributed DDL docs](https://clickhouse.com/docs/reference/statements/distributed-ddl), `ON CLUSTER` runs the `CREATE`, `DROP`, `ALTER` or `RENAME` on every host in the named cluster, and needs the same cluster definition on every host plus a connection to ZooKeeper or Keeper. Without it, the statement only affects the server you run it on. The CREATE VIEW reference also warns that `POPULATE` can miss or duplicate rows inserted through `ON CLUSTER`, a Distributed table or other replicas. I could not test a cluster for this guide, so check the details against those two pages for your setup.

## Querying the target table from TypeScript

Read from the target table, not the view, and aggregate again. With hypequery and a schema generated from your database:

```ts
import { createQueryBuilder } from '@hypequery/clickhouse';
import type { IntrospectedSchema } from './schema';

const db = createQueryBuilder<IntrospectedSchema>({
  host: process.env.CLICKHOUSE_HOST!,
  username: process.env.CLICKHOUSE_USERNAME!,
  password: process.env.CLICKHOUSE_PASSWORD!,
  database: process.env.CLICKHOUSE_DATABASE!,
});

// { day: string; page: string; views: string }[]
const rows = await db
  .table('page_views_daily')
  .select(['day', 'page'])
  .sum('views', 'views')
  .where('day', 'gte', '2026-11-01')
  .groupBy(['day', 'page'])
  .orderBy('day', 'DESC')
  .execute();
```

`sum()` of a `UInt64` column is `UInt64`, so `views` arrives as a string, and `day` (a `Date`) does too. The `.sum(...).groupBy(...)` is the same re-aggregation as the SQL above, so the result does not depend on whether merges have run.

## Related

- [A guide to materialized views in ClickHouse](/blog/a-guide-to-materialized-views-in-clickhouse)
- [ClickHouse refreshable materialized views](/blog/clickhouse-refreshable-materialized-views)
- [FINAL vs ReplacingMergeTree dedup](/blog/clickhouse-final-replacingmergetree-typescript)
- [Type-safe schema management for ClickHouse](/blog/type-safe-schema-management-clickhouse)
- [ClickHouse time-series analytics](/clickhouse-time-series)
- ClickHouse docs: [CREATE VIEW](https://clickhouse.com/docs/reference/statements/create/view), [Backfilling data](https://clickhouse.com/docs/guides/clickhouse/data-modelling/backfilling), [ALTER VIEW](https://clickhouse.com/docs/reference/statements/alter/view), [Distributed DDL](https://clickhouse.com/docs/reference/statements/distributed-ddl), [AggregatingMergeTree](https://clickhouse.com/docs/reference/engines/table-engines/mergetree-family/aggregatingmergetree), [ClickHouse 26.8 release](https://clickhouse.com/blog/clickhouse-release-26-08)
