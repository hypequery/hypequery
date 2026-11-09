---
title: "ClickHouse Refreshable Materialized Views: REFRESH EVERY, APPEND and DEPENDS ON"
description: "How refreshable materialized views work in ClickHouse: the REFRESH EVERY and AFTER schedules, replace vs APPEND, DEPENDS ON, SYSTEM REFRESH VIEW, system.view_refreshes, and when to use an incremental view instead. Every query checked on ClickHouse 26.6."
seoTitle: "ClickHouse Refreshable Materialized View: Syntax & Refresh"
seoDescription: "A ClickHouse refreshable materialized view reruns its SELECT on a schedule (REFRESH EVERY/AFTER) and atomically replaces the target. No setting needed."
pubDate: 2026-11-08
updatedAt: 2026-11-08
heroImage: ""
slug: clickhouse-refreshable-materialized-views
status: published
tags:
  - ClickHouse
  - Materialized Views
---

A refreshable materialized view in ClickHouse reruns its whole `SELECT` on a schedule (`REFRESH EVERY 1 HOUR` or `REFRESH AFTER 10 MINUTE`) and atomically replaces the contents of its target table, or adds rows to it when you write `APPEND`. On ClickHouse 26.6 no setting is needed: `allow_experimental_refreshable_materialized_view` is marked obsolete and does nothing, but the default replace mode needs a database with the Atomic or Replicated engine. You trigger a refresh by hand with `SYSTEM REFRESH VIEW` and check status in `system.view_refreshes`.

This guide covers the refreshable kind only. For how incremental (insert-triggered) views work and the production pitfalls around them, see the main [guide to materialized views in ClickHouse](/blog/a-guide-to-materialized-views-in-clickhouse). Everything below was run on ClickHouse 26.6.

## Do refreshable materialized views need a setting enabled?

No. On ClickHouse 26.6 the old experimental flag still exists but is a no-op:

```sql
SELECT name, value, is_obsolete, description
FROM system.settings
WHERE name = 'allow_experimental_refreshable_materialized_view';
```

```text
name:        allow_experimental_refreshable_materialized_view
value:       1
is_obsolete: 1
description: Obsolete setting, does nothing.
```

`system.settings_changes` records the change under version 24.10 with the note "Not experimental anymore". If you are on an older server, check that table on your own version before relying on the feature.

What you do need is the right database engine. A refreshable view in replace mode on a database with another engine fails at `CREATE` time. This is what `clickhouse local` returns, because its `default` database uses the Overlay engine:

```text
Code: 80. DB::Exception: Refreshable materialized views (except with APPEND) only support
Atomic and Replicated database engines, but database default has engine Overlay. (INCORRECT_QUERY)
```

On 26.6, `CREATE DATABASE app` without an `ENGINE` clause creates an Atomic database, so on a normal server this rarely comes up.

## How do you create a refreshable materialized view in ClickHouse?

Add a `REFRESH` clause to `CREATE MATERIALIZED VIEW` and point it at a target table with `TO`. The view runs its first refresh straight after creation, and `SYSTEM WAIT VIEW` blocks until that refresh finishes.

```sql
CREATE DATABASE app ENGINE = Atomic;
USE app;

CREATE TABLE events
(
    ts DateTime,
    user_id UInt32,
    country String
)
ENGINE = MergeTree
ORDER BY ts;

INSERT INTO events VALUES
    ('2026-11-01 10:00:00', 1, 'IE'),
    ('2026-11-01 11:00:00', 2, 'IE'),
    ('2026-11-02 09:00:00', 3, 'US');

CREATE TABLE country_totals
(
    country String,
    users UInt64
)
ENGINE = MergeTree
ORDER BY country;

CREATE MATERIALIZED VIEW country_totals_mv
REFRESH EVERY 1 HOUR
TO country_totals
AS SELECT country, uniqExact(user_id) AS users
FROM events
GROUP BY country;

SYSTEM WAIT VIEW country_totals_mv;
SELECT * FROM country_totals ORDER BY country;
```

```text
IE  2
US  1
```

The three rows that were already in `events` are in the target. An incremental view would have ignored them, because it only sees rows inserted after it exists.

You can also leave out `TO` and give the view an `ENGINE` instead. ClickHouse then creates a hidden `.inner_id.<uuid>` table to hold the result, which you can read by selecting from the view name. A named target is easier to find and inspect, so the rest of this guide uses `TO`.

One restriction: a table can be the target of only one refreshable view in replace mode. Pointing a second one at `top_country` returned:

```text
Code: 36. DB::Exception: Table app.top_country is already a target of another
refreshable materialized view: app.top_country_mv. (BAD_ARGUMENTS)
```

## How do you refresh a materialized view manually in ClickHouse?

Run `SYSTEM REFRESH VIEW <name>`. It starts a refresh in the background and returns immediately, so follow it with `SYSTEM WAIT VIEW <name>` if the next statement needs the new data.

```sql
INSERT INTO events VALUES ('2026-11-03 09:00:00', 4, 'DE');

SELECT count() FROM country_totals;   -- 2: the new row is not there yet

SYSTEM REFRESH VIEW country_totals_mv;
SYSTEM WAIT VIEW country_totals_mv;

SELECT * FROM country_totals ORDER BY country;
```

```text
DE  1
IE  2
US  1
```

The target has three rows, not five. In replace mode each refresh swaps in the full new result. On 26.6 you can see this in `system.tables`: the `uuid` of `country_totals` changed after every refresh, so the target is replaced by a new table rather than rewritten in place.

The other `SYSTEM` commands for refreshable views, from the [SYSTEM statements reference](https://clickhouse.com/docs/reference/statements/system):

| Statement | What it does |
|---|---|
| `SYSTEM REFRESH VIEW v` | Start a refresh now |
| `SYSTEM WAIT VIEW v` | Block until the running refresh finishes; raises an error if it failed |
| `SYSTEM STOP VIEW v` / `SYSTEM START VIEW v` | Pause and resume scheduled refreshes |
| `SYSTEM STOP VIEWS` / `SYSTEM START VIEWS` | The same for every refreshable view on the server |
| `SYSTEM CANCEL VIEW v` | Stop the refresh that is running |

After `SYSTEM STOP VIEW country_totals_mv`, the view's status in `system.view_refreshes` was `Disabled`. After `SYSTEM START VIEW` it went back to `Scheduled`.

## REFRESH EVERY vs REFRESH AFTER

`REFRESH EVERY` runs on fixed clock boundaries, while `REFRESH AFTER` waits a fixed interval after the previous refresh ends. These are the next refresh times ClickHouse 26.6 scheduled with the server time zone set to UTC at 15:31:

| Clause | `next_refresh_time` |
|---|---|
| `REFRESH EVERY 30 MINUTE` | 16:00:00 the same day |
| `REFRESH EVERY 1 HOUR RANDOMIZE FOR 10 MINUTE` | 16:01:38 (a random point near 16:00) |
| `REFRESH EVERY 1 DAY OFFSET 2 HOUR` | 02:00:00 the next day |
| `REFRESH AFTER 10 MINUTE` | 10 minutes after the last refresh finished |

The [CREATE VIEW reference](https://clickhouse.com/docs/reference/statements/create/view) says `EVERY 1 DAY` runs at midnight UTC, and that `OFFSET` shifts the time within the period. On a server set to Europe/Madrid (UTC+1 in November), `EVERY 1 DAY OFFSET 2 HOUR` showed 03:00 local time, which is 02:00 UTC. `OFFSET` is only valid with `EVERY`: `REFRESH AFTER 1 HOUR OFFSET 5 MINUTE` is a syntax error. `RANDOMIZE FOR` adds a random shift to each refresh time; the docs example `EVERY 1 DAY OFFSET 2 HOUR RANDOMIZE FOR 1 HOUR` runs at a random time between 01:30 and 02:30.

Two more rules from the same reference page:

- At most one refresh runs at a time for a given view. If a refresh takes longer than its interval, the next one starts when it finishes, and missed slots are not caught up.
- Adding `EMPTY` skips the first refresh at creation time. A view created with `REFRESH EVERY 1 DAY OFFSET 2 HOUR ... EMPTY` had 0 rows and no `last_refresh_time` until its first scheduled run.

You cannot combine `POPULATE` with `REFRESH`. The first refresh already fills the view.

## APPEND vs replace: which refresh mode do you need?

Use the default replace mode when the target should hold the current answer. Use `APPEND` when each refresh should add a new batch of rows, such as a periodic snapshot.

```sql
CREATE TABLE country_snapshots
(
    snapshot_time DateTime,
    country String,
    users UInt64
)
ENGINE = MergeTree
ORDER BY (snapshot_time, country);

CREATE MATERIALIZED VIEW country_snapshots_mv
REFRESH EVERY 1 HOUR APPEND
TO country_snapshots
AS SELECT now() AS snapshot_time, country, uniqExact(user_id) AS users
FROM events
GROUP BY country;
```

After the first refresh, one more `US` user, and a manual refresh, the table held both snapshots:

```text
2026-11-08 15:31:48  IE  2
2026-11-08 15:31:48  US  1
2026-11-08 15:31:50  IE  2
2026-11-08 15:31:50  US  2
```

| | Replace (default) | `APPEND` |
|---|---|---|
| Each refresh | Atomically replaces the previous contents | Inserts new rows and keeps old ones |
| Atomicity | Readers see the old or the new result, never a mix | Not atomic, like a regular `INSERT ... SELECT` (per the docs) |
| Database engine | Atomic or Replicated | Any; it worked on the Overlay database in `clickhouse local` |
| Typical use | Current totals, denormalized tables, joins | History, snapshots, audit tables |

ClickHouse 26.9 added `APPEND INCREMENTAL`, which makes each refresh read only the rows committed to the source since the last one ([26.9 release post](https://clickhouse.com/blog/clickhouse-release-26-09)). It is not in 26.6, where the same statement is a syntax error, so check your version before using it.

## How do you chain refreshable views with DEPENDS ON?

`DEPENDS ON other_view` makes a refreshable view wait until the views it depends on have finished refreshing. This builds a small pipeline without an external scheduler.

```sql
CREATE TABLE top_country
(
    country String,
    users UInt64
)
ENGINE = MergeTree
ORDER BY country;

CREATE MATERIALIZED VIEW top_country_mv
REFRESH EVERY 1 HOUR
DEPENDS ON country_totals_mv
TO top_country
AS SELECT country, users
FROM country_totals
ORDER BY users DESC
LIMIT 1;
```

Name the upstream view, not its target table. A view created with `DEPENDS ON country_totals` (the table) never refreshed, and `system.view_refreshes` showed its status as `MissingDependencies`. The docs state that `DEPENDS ON` only works between refreshable materialized views.

When both views use the same `EVERY` period, the dependency applies per time slot. The docs warn that either view can skip a slot if a refresh runs long, so one dependent refresh per upstream refresh is not guaranteed.

## How do you monitor refreshes with system.view_refreshes?

`system.view_refreshes` has one row per refreshable view with its current status, last and next refresh times, rows read and written, and the last error.

```sql
SELECT view, status, last_success_time, next_refresh_time, read_rows, written_rows, exception
FROM system.view_refreshes
WHERE database = 'app' AND view = 'country_totals_mv'
FORMAT Vertical;
```

```text
view:              country_totals_mv
status:            Scheduled
last_success_time: 2026-11-08 15:33:14
next_refresh_time: 2026-11-08 16:00:00
read_rows:         4
written_rows:      3
exception:
```

When a refresh fails, the previous contents stay in place. I tested this with a view whose query calls `throwIf(count() > 1, 'too many rows')`. It refreshed fine with one source row, and after a second row was inserted the manual refresh failed. `SYSTEM WAIT VIEW` raised `Code: 730 ... Refresh failed: ... too many rows ... (REFRESH_FAILED)`, the view still returned the first result, and the `exception` column held the error message.

Failed refreshes are retried with exponential backoff. Per the docs, the defaults are `refresh_retries = 2`, `refresh_retry_initial_backoff_ms = 100` and `refresh_retry_max_backoff_ms = 60000`. Set them in the `REFRESH` clause:

```sql
CREATE MATERIALIZED VIEW guarded_mv
REFRESH EVERY 1 HOUR SETTINGS refresh_retries = 0
ENGINE = MergeTree ORDER BY tuple()
AS SELECT count() AS n FROM events;
```

The [refreshable views concept page](https://clickhouse.com/docs/concepts/features/materialized-views/refreshable-materialized-view) also warns that views not coordinated through Keeper lose track of their last refresh time on restart, so they can all refresh at once when the server comes back.

## How do you change the refresh schedule?

Use `ALTER TABLE <view> MODIFY REFRESH` with the full new refresh clause:

```sql
ALTER TABLE country_totals_mv MODIFY REFRESH EVERY 15 MINUTE;
SHOW CREATE TABLE country_totals_mv;
```

`SHOW CREATE TABLE` then contained `REFRESH EVERY 15 MINUTE TO app.country_totals`. The [ALTER VIEW reference](https://clickhouse.com/docs/reference/statements/alter/view) notes that the statement replaces all refresh parameters at once, so any `DEPENDS ON`, `RANDOMIZE FOR` or `SETTINGS` you leave out are removed. It also says you cannot add or remove `APPEND` this way; recreate the view for that.

## Refreshable vs incremental materialized views: when to use each

An incremental materialized view runs its `SELECT` on each block inserted into the source table and writes the result to the target, so it is current within one insert but only sees new rows. A refreshable view recomputes from all the data on a schedule, so it is stale between refreshes but sees every change to every table it reads.

Joins show the difference most clearly. I built the same revenue-by-region query both ways over `orders` joined to `customers`, inserted three orders, then moved customer 1 from `EMEA` to `APAC` and refreshed:

```sql
CREATE MATERIALIZED VIEW revenue_by_region_mv
REFRESH EVERY 1 HOUR
TO revenue_by_region
AS SELECT c.region AS region, sum(o.amount) AS revenue
FROM orders AS o
INNER JOIN customers AS c ON o.customer_id = c.customer_id
GROUP BY region;
```

```text
incremental          refreshable
AMER  20             AMER  20
EMEA  80             APAC  80
```

The incremental view still reports `EMEA`, because it only fires on inserts into `orders`, the left-hand table, and never looks at `customers` again. The refreshable view picked up the change on its next refresh.

| | Incremental MV | Refreshable MV |
|---|---|---|
| Runs when | Every insert into the source table | On a schedule or `SYSTEM REFRESH VIEW` |
| Reads | Only the inserted block | All the data the query touches |
| Existing rows at creation | Ignored unless you backfill | Included in the first refresh |
| Updates, deletes, dimension changes | Not seen | Seen on the next refresh |
| Cost per run | Small, paid on each insert | Full query, paid per refresh |
| Freshness | Current with the last insert | As old as the last refresh |

The ClickHouse docs say incremental views are usually the preferred choice, because they scale to very large data. Pick an incremental view for high-volume aggregations of one table that must stay current. Pick a refreshable view for joins against tables that change, for denormalization jobs, and for queries over a result small enough to recompute every interval. For creating incremental views with `TO`, backfilling them and managing them, see [how to create a materialized view with a TO table and backfill it](/blog/clickhouse-create-materialized-view-to-table-backfill).

## Querying a refreshable view's target from TypeScript

The target of a refreshable view is an ordinary table with ordinary column types, so you query it like any other table. With hypequery the generated schema types the result:

```ts
import { createQueryBuilder } from '@hypequery/clickhouse';
import type { IntrospectedSchema } from './schema';

const db = createQueryBuilder<IntrospectedSchema>({
  host: process.env.CLICKHOUSE_HOST!,
  username: process.env.CLICKHOUSE_USERNAME!,
  password: process.env.CLICKHOUSE_PASSWORD!,
  database: process.env.CLICKHOUSE_DATABASE!,
});

// { country: string; users: string }[]
const rows = await db
  .table('country_totals')
  .select(['country', 'users'])
  .orderBy('users', 'DESC')
  .execute();
```

`users` is `UInt64`, so it arrives as a string: hypequery asks ClickHouse to quote 64-bit integers in JSON so large values keep their precision. Convert with `Number()` or `BigInt()` when you need arithmetic. Because replace mode swaps the whole table, a query never sees a half-written refresh.

## Related

- [A guide to materialized views in ClickHouse](/blog/a-guide-to-materialized-views-in-clickhouse)
- [How to create a materialized view in ClickHouse with a TO table and backfill it](/blog/clickhouse-create-materialized-view-to-table-backfill)
- [FINAL vs ReplacingMergeTree dedup](/blog/clickhouse-final-replacingmergetree-typescript)
- [ClickHouse joins in TypeScript](/blog/clickhouse-joins-typescript)
- [ClickHouse for real-time analytics](/clickhouse-real-time-analytics)
- ClickHouse docs: [CREATE VIEW (refreshable materialized view)](https://clickhouse.com/docs/reference/statements/create/view), [Refreshable materialized views](https://clickhouse.com/docs/concepts/features/materialized-views/refreshable-materialized-view), [system.view_refreshes](https://clickhouse.com/docs/reference/system-tables/view_refreshes), [SYSTEM statements](https://clickhouse.com/docs/reference/statements/system), [ALTER VIEW](https://clickhouse.com/docs/reference/statements/alter/view)
