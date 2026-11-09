---
title: "ClickHouse View vs Materialized View: CREATE VIEW, Parameterized Views and SQL SECURITY"
description: "The kinds of views in ClickHouse and how they differ: normal views, parameterized views, incremental and refreshable materialized views, plus CREATE, REPLACE, ALTER, DROP and SQL SECURITY. Every query checked on ClickHouse 26.6."
seoTitle: "ClickHouse View vs Materialized View: CREATE VIEW Guide"
seoDescription: "A ClickHouse view stores only a query and runs it on every read. A materialized view stores results in a table, filled on insert or on a refresh schedule."
pubDate: 2026-11-08
updatedAt: 2026-11-08
heroImage: ""
slug: clickhouse-view-vs-materialized-view
status: published
tags:
  - ClickHouse
  - Materialized Views
---

A ClickHouse view (`CREATE VIEW`) stores only a `SELECT` statement and runs it as a subquery every time you read from it, so it holds no data and is always current. A materialized view (`CREATE MATERIALIZED VIEW`) stores results in a table: an incremental materialized view runs its query on each block inserted into the source table, and a refreshable materialized view re-runs the whole query on a schedule. ClickHouse also has parameterized views, which are normal views with typed placeholders called like a table function, and every view can run with the privileges of its definer or of the caller through `SQL SECURITY`.

The examples below were run on ClickHouse 26.6. They use a database called `shop` and this table, with one event per minute from 2026-11-01:

```sql
CREATE DATABASE shop;
USE shop;

CREATE TABLE events
(
    event_time DateTime,
    user_id UInt32,
    event_type LowCardinality(String),
    revenue Decimal(10, 2)
)
ENGINE = MergeTree
ORDER BY event_time;

INSERT INTO events
SELECT
    toDateTime('2026-11-01 00:00:00') + number * 60,
    number % 100,
    ['view', 'click', 'purchase'][number % 3 + 1],
    toDecimal64(number % 50, 2)
FROM numbers(100000);
```

## What kinds of views does ClickHouse have?

The four kinds of views you will use in ClickHouse are normal views, parameterized views, incremental materialized views and refreshable materialized views. Only the materialized kinds store data.

| Kind | Created with | Stores data | When the query runs |
|---|---|---|---|
| Normal view | `CREATE VIEW v AS SELECT ...` | No | Every time `v` is read |
| Parameterized view | `CREATE VIEW v AS SELECT ... WHERE x = {p:Type}` | No | Every time `v(p = ...)` is read |
| Incremental materialized view | `CREATE MATERIALIZED VIEW mv TO t AS SELECT ...` | Yes, in `t` | On each insert into the source, over the inserted block |
| Refreshable materialized view | `CREATE MATERIALIZED VIEW mv REFRESH EVERY ... TO t AS SELECT ...` | Yes, in `t` | On the refresh schedule, over all data |

The docs also describe live views, marked "deprecated and will be removed in the future" ([CREATE VIEW](https://clickhouse.com/docs/sql-reference/statements/create/view)). This guide skips them.

## How do you create a view in ClickHouse (CREATE VIEW)?

`CREATE VIEW name AS SELECT ...` saves the query under a name, and reading from the view runs that query. The docs put it plainly: "a normal view is nothing more than a saved query", used "as a subquery in the FROM clause" ([CREATE VIEW](https://clickhouse.com/docs/sql-reference/statements/create/view)).

```sql
CREATE VIEW purchases AS
SELECT event_time, user_id, revenue
FROM events
WHERE event_type = 'purchase';

SELECT count(), sum(revenue) FROM purchases;
```

```text
33333	816650
```

Because nothing is stored, a new row in `events` shows up in the view immediately:

```sql
INSERT INTO events VALUES ('2027-01-15 12:00:00', 7, 'purchase', 99);

SELECT count(), sum(revenue) FROM purchases;
```

```text
33334	816749
```

Filters you add when querying the view still reach the source table's primary key. This query on `purchases` filters on `event_time`, the sort key of `events`, and the plan reads 7 of 13 granules (output trimmed):

```sql
EXPLAIN indexes = 1
SELECT count() FROM purchases WHERE event_time >= '2026-12-10 00:00:00';
```

```text
ReadFromMergeTree (shop.events)
Indexes:
  PrimaryKey
    Keys:
      event_time
    Parts: 2/2
    Granules: 7/13
```

A normal view is read-only. Inserting into one fails:

```sql
INSERT INTO purchases VALUES (now(), 1, 10);
```

```text
Code: 48. DB::Exception: Method write is not supported by storage View. (NOT_IMPLEMENTED)
```

`CREATE VIEW` on a name that already exists fails with `TABLE_ALREADY_EXISTS`. `CREATE VIEW IF NOT EXISTS` does not fail, and it also does not change the existing view: in our test, the original definition stayed in place.

## How do you replace a view (CREATE OR REPLACE VIEW)?

`CREATE OR REPLACE VIEW` swaps the stored query of an existing view, or creates the view if it does not exist. It is the way to change a normal view:

```sql
CREATE OR REPLACE VIEW purchases AS
SELECT event_time, user_id, revenue, toDate(event_time) AS day
FROM events
WHERE event_type = 'purchase';

SELECT * FROM purchases ORDER BY event_time LIMIT 3;
```

```text
2026-11-01 00:02:00	2	2	2026-11-01
2026-11-01 00:05:00	5	5	2026-11-01
2026-11-01 00:08:00	8	8	2026-11-01
```

## Is there an ALTER VIEW in ClickHouse?

There is no `ALTER VIEW` statement, and normal views do not support `ALTER TABLE ... MODIFY QUERY` either; on 26.6 both of these fail:

```sql
ALTER VIEW purchases MODIFY QUERY SELECT user_id FROM events;

ALTER TABLE purchases MODIFY QUERY SELECT user_id FROM events;
```

```text
Code: 62. DB::Exception: Syntax error: failed at position 12 (purchases): purchases MODIFY QUERY SELECT user_id FROM events;. ... (SYNTAX_ERROR)
Code: 48. DB::Exception: Alter of type 'MODIFY_QUERY' is not supported by storage View. (NOT_IMPLEMENTED)
```

For a normal view, use `CREATE OR REPLACE VIEW`. For a materialized view, `ALTER TABLE mv MODIFY QUERY SELECT ...` changes the query and applies to future inserts only; the docs note that it "does not change the structure of the underlying storage table" ([ALTER TABLE ... MODIFY QUERY](https://clickhouse.com/docs/sql-reference/statements/alter/view)). `ALTER TABLE v MODIFY SQL SECURITY` does work on a normal view, as shown below.

## How do you see a view's definition (SHOW CREATE VIEW)?

`SHOW CREATE VIEW name` returns the full `CREATE` statement, with the column list ClickHouse inferred and table names qualified with the database:

```sql
SHOW CREATE VIEW purchases;
```

```text
CREATE VIEW shop.purchases
(
    `event_time` DateTime,
    `user_id` UInt32,
    `revenue` Decimal(10, 2),
    `day` Date
)
AS SELECT
    event_time,
    user_id,
    revenue,
    toDate(event_time) AS day
FROM shop.events
WHERE event_type = 'purchase'
```

(`clickhouse local` prints this on one line with `\n` escapes; add `FORMAT TSVRaw` to get line breaks.) To list views, filter `system.tables` by engine; the `as_select` column holds the query:

```sql
SELECT name, engine
FROM system.tables
WHERE database = 'shop'
ORDER BY name;
```

```text
events	MergeTree
purchases	View
```

## How do you drop a view in ClickHouse?

`DROP VIEW name` (or `DROP VIEW IF EXISTS name`) removes a view; `DROP TABLE` on a view also works. `DROP VIEW` refuses to drop a real table, which makes it the safer statement:

```sql
DROP VIEW events;
```

```text
Code: 80. DB::Exception: Table shop.events is not a View. (INCORRECT_QUERY)
```

The reverse is not protected by default: with `check_referential_table_dependencies = 0` (the default on 26.6), `DROP TABLE events` succeeded while a view depended on it, and reading the view afterwards failed with `UNKNOWN_TABLE`.

## What is a parameterized view in ClickHouse?

A parameterized view is a normal view whose query contains typed placeholders such as `{event_type:String}`, and you pass values by calling the view like a table function: `view_name(event_type = 'purchase')`. It is useful for exposing one reusable query with a few inputs:

```sql
CREATE VIEW daily_by_type AS
SELECT toDate(event_time) AS day, count() AS events, sum(revenue) AS revenue
FROM events
WHERE event_type = {event_type:String}
  AND event_time >= {from:DateTime}
GROUP BY day;

SELECT *
FROM daily_by_type(event_type = 'purchase', from = '2026-12-01 00:00:00')
ORDER BY day
LIMIT 3;
```

```text
2026-12-01	480	11690
2026-12-02	480	11740
2026-12-03	480	11740
```

Reading it without arguments fails, because the docs note a parameterized view "doesn't have a schema when parameters are not provided" ([CREATE VIEW](https://clickhouse.com/docs/sql-reference/statements/create/view)):

```sql
SELECT * FROM daily_by_type;
```

```text
Code: 51. DB::Exception: Empty list of columns in projection. In scope SELECT * FROM daily_by_type. (EMPTY_LIST_OF_COLUMNS_QUERIED)
```

In an application, pass the arguments as query parameters rather than building the string yourself. With `clickhouse local --param_t=purchase`, the query `SELECT * FROM daily_by_type(event_type = {t:String}, from = '2026-12-01 00:00:00')` resolved `{t:String}` before calling the view.

## What is a materialized view in ClickHouse?

A materialized view in ClickHouse is an insert trigger: when rows are inserted into the source table, it runs its `SELECT` over that inserted block and writes the result into a target table. The docs say materialized views "are implemented more like insert triggers", and any aggregation "is applied only to the batch of freshly inserted data" ([CREATE VIEW](https://clickhouse.com/docs/sql-reference/statements/create/view)).

```sql
CREATE TABLE daily_revenue
(
    day Date,
    revenue Decimal(38, 2)
)
ENGINE = SummingMergeTree
ORDER BY day;

CREATE MATERIALIZED VIEW daily_revenue_mv TO daily_revenue AS
SELECT toDate(event_time) AS day, sum(revenue) AS revenue
FROM events
WHERE event_type = 'purchase'
GROUP BY day;

SELECT count() FROM daily_revenue;
```

```text
0
```

The 100,001 rows already in `events` are not in the target: the view only sees inserts that happen after it exists. A new insert flows through:

```sql
INSERT INTO events VALUES
    ('2027-02-01 08:00:00', 1, 'purchase', 100),
    ('2027-02-01 09:00:00', 2, 'purchase', 50),
    ('2027-02-01 09:30:00', 3, 'view', 0);

SELECT day, sum(revenue) FROM daily_revenue GROUP BY day;
```

```text
2027-02-01	150
```

Queries read `daily_revenue`, the target table, and use `sum()` because `SummingMergeTree` only combines rows when parts merge. Backfilling history, choosing the target engine and the `POPULATE` trap are covered in the [guide to materialized views in ClickHouse](/blog/a-guide-to-materialized-views-in-clickhouse).

## ClickHouse view vs materialized view: what is the difference?

A view costs nothing on insert and the full query on every read; a materialized view costs work on every insert and makes reads cheap, at the price of storing data and of never seeing updates or deletes on the source.

| | View | Materialized view (incremental) |
|---|---|---|
| Stores rows | No | Yes, in the target table |
| Work happens | At read time | At insert time |
| Freshness | Always current | Current as of the last insert |
| Existing source data | Included | Not included unless you backfill |
| `ALTER TABLE ... DELETE` on source | Reflected | Not reflected |
| Change the query | `CREATE OR REPLACE VIEW` | `ALTER TABLE mv MODIFY QUERY` (future inserts only) |
| You query | The view | The target table (or the view name) |

Use a view to name and reuse a query, hide columns, or give users a stable interface. Use a materialized view when the same aggregation over a large, append-only table is too slow to run on every read. If the goal is a different sort order or a simple rollup of one table, a projection may fit better: see [projections vs materialized views](/blog/clickhouse-projections-vs-materialized-views).

## What is a refreshable materialized view?

A refreshable materialized view re-runs its full query on a schedule and, by default, atomically replaces the target table's contents with the result. It suits queries that incremental views handle badly, such as top-N lists or joins that should see all data:

```sql
CREATE TABLE top_users (user_id UInt32, revenue Decimal(38, 2))
ENGINE = MergeTree ORDER BY user_id;

CREATE MATERIALIZED VIEW top_users_mv
REFRESH EVERY 1 HOUR
TO top_users AS
SELECT user_id, sum(revenue) AS revenue
FROM events
WHERE event_type = 'purchase'
GROUP BY user_id
ORDER BY revenue DESC
LIMIT 3;

SYSTEM WAIT VIEW top_users_mv;

SELECT view, status FROM system.view_refreshes;
```

```text
top_users_mv	Scheduled
```

Without `APPEND`, refreshable views need an Atomic or Replicated database; in the default `Overlay` database of `clickhouse local`, 26.6 rejected the `CREATE` with `INCORRECT_QUERY`. Schedules, `DEPENDS ON`, `APPEND` and monitoring are in the [refreshable materialized views guide](/blog/clickhouse-refreshable-materialized-views).

## How does SQL SECURITY DEFINER work for ClickHouse views?

`SQL SECURITY DEFINER` makes the view's query run with the privileges of the user named in `DEFINER`, while `SQL SECURITY INVOKER` runs it with the privileges of whoever reads the view. `NONE` is the third value. In every case the reader still needs `SELECT` on the view itself ([CREATE VIEW, SQL security](https://clickhouse.com/docs/sql-reference/statements/create/view)).

This test shows the view running as the definer. The session user (`default`) can read everything, but the view's definer can only read `events`, so the view fails:

```sql
CREATE USER report_owner IDENTIFIED WITH no_password;
GRANT SELECT ON shop.events TO report_owner;

CREATE TABLE salaries (user_id UInt32, salary UInt32)
ENGINE = MergeTree ORDER BY user_id;

CREATE VIEW salary_total
DEFINER = report_owner SQL SECURITY DEFINER
AS SELECT sum(salary) FROM salaries;

SELECT * FROM salary_total;
```

```text
Code: 497. DB::Exception: report_owner: Not enough privileges. To execute this query, it's necessary to have the grant SELECT ON shop.salaries. (ACCESS_DENIED)
```

The usual pattern is the opposite: a definer that can read the base tables, and readers that get `GRANT SELECT` on the view only. They can query the view without any grant on the tables behind it. Per the docs, setting a `DEFINER` other than yourself requires the `SET DEFINER` grant on that user.

To change it later:

```sql
ALTER TABLE salary_total MODIFY SQL SECURITY INVOKER;

SHOW CREATE VIEW salary_total;
```

```text
CREATE VIEW shop.salary_total
(
    `sum(salary)` UInt64
)
SQL SECURITY INVOKER
AS SELECT sum(salary)
FROM shop.salaries
```

What a view gets when you omit `SQL SECURITY` depends on the server setting `ignore_empty_sql_security_in_create_view_query`. On 26.6 it is `1`, and the docs say that then "the view gets an empty SQL security type"; a plain `CREATE VIEW` in our test showed no `SQL SECURITY` line in `SHOW CREATE`. With the setting at `0`, ClickHouse writes in the defaults: `INVOKER` for normal views (`default_normal_view_sql_security`), `DEFINER` for materialized views (`default_materialized_view_sql_security`), and `CURRENT_USER` as the definer (`default_view_definer`). Those three settings read `INVOKER`, `DEFINER` and `CURRENT_USER` on 26.6. Refreshable materialized views always get the defaults.

## Querying ClickHouse views from TypeScript

A normal view reads like a table, so a typed client can query it the same way. hypequery's type generator lists tables with `SHOW TABLES`, which returns views too, so `purchases` gets a generated type next to `events`:

```ts
import { createQueryBuilder } from '@hypequery/clickhouse';
import type { IntrospectedSchema } from './schema';

const db = createQueryBuilder<IntrospectedSchema>({
  host: process.env.CLICKHOUSE_HOST!,
  username: process.env.CLICKHOUSE_USERNAME!,
  password: process.env.CLICKHOUSE_PASSWORD!,
  database: process.env.CLICKHOUSE_DATABASE!,
});

const topBuyers = await db
  .table('purchases')
  .select(['user_id'])
  .sum('revenue', 'revenue')
  .where('event_time', 'gte', '2026-12-01 00:00:00')
  .groupBy('user_id')
  .orderBy('revenue', 'DESC')
  .limit(5)
  .execute();
// topBuyers: { user_id: number; revenue: string }[]
```

`user_id` is `UInt32`, so it arrives as a `number`; the `sum()` result is typed as `string`. Pairing views with [read-only ClickHouse users](/docs/reference/readonly-users) is a simple way to give an app or an [MCP server](/clickhouse-mcp) a narrow, stable surface.

## Related

- [A guide to materialized views in ClickHouse](/blog/a-guide-to-materialized-views-in-clickhouse)
- [ClickHouse refreshable materialized views](/blog/clickhouse-refreshable-materialized-views)
- [ClickHouse projections vs materialized views](/blog/clickhouse-projections-vs-materialized-views)
- [Read-only users for hypequery](/docs/reference/readonly-users)
- [ClickHouse schema types in TypeScript](/clickhouse-schema)
- ClickHouse docs: [CREATE VIEW](https://clickhouse.com/docs/sql-reference/statements/create/view), [ALTER TABLE ... MODIFY QUERY](https://clickhouse.com/docs/sql-reference/statements/alter/view)
