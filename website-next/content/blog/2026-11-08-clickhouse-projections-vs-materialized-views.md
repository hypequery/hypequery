---
title: "ClickHouse Projections vs Materialized Views: When to Use Each"
description: "How projections and materialized views store data in ClickHouse, which queries can use a projection, what each costs on insert, and a decision table. Every query checked on ClickHouse 26.6."
seoTitle: "ClickHouse Projections vs Materialized Views"
seoDescription: "A projection is a hidden copy inside the same table that queries use automatically. A materialized view writes to a separate table you query by name."
pubDate: 2026-11-08
updatedAt: 2026-11-08
heroImage: ""
slug: clickhouse-projections-vs-materialized-views
status: published
tags:
  - ClickHouse
  - Materialized Views
---

A ClickHouse projection is a hidden, re-sorted or pre-aggregated copy of a table's data stored inside each data part of that same table, and the query optimizer reads from it automatically when it can answer a query with less data. A materialized view is an insert trigger that runs a `SELECT` over each new block and writes the result into a separate table, which you query by name. Use a projection when you want a second sort order or a simple rollup of one table without changing queries; use a materialized view when you need joins, filters, a different schema, a different TTL, or a chain of transformations.

This guide shows how each one stores data, how to prove with `EXPLAIN` that a projection was used, and where projections stop working. Everything below was run on ClickHouse 26.6. For the full treatment of materialized views (engines, `TO` tables, `POPULATE`, monitoring), see the [guide to materialized views in ClickHouse](/blog/a-guide-to-materialized-views-in-clickhouse).

## What is the difference between a projection and a materialized view in ClickHouse?

A projection lives inside the source table and is written and merged together with each part, while a materialized view writes to its own table that queries must target explicitly. The ClickHouse docs describe the trade this way: with materialized views "the user has to select the appropriate optimized target table or rewrite their query", whereas projections are "automatically updated and kept in-sync with the original table" ([Projections, ClickHouse docs](https://clickhouse.com/docs/data-modeling/projections)).

| | Projection | Materialized view |
|---|---|---|
| Where the data lives | Inside each part of the source table | A separate target table |
| How queries use it | Optimizer picks it automatically | You query the target table by name |
| Definition can use `JOIN` or `WHERE` | No (syntax error on 26.6) | Yes |
| Reacts to `ALTER TABLE ... DELETE` on the source | Yes, the projection is rebuilt | No, the target keeps old rows |
| Own table engine and TTL | No | Yes |
| Can feed another view | No | Yes |

The examples use this table with 1,000,000 rows, one row every 3 seconds from 2026-01-01 (about 35 days):

```sql
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
    toDateTime('2026-01-01 00:00:00') + number * 3 AS event_time,
    number % 50000 AS user_id,
    ['view', 'click', 'purchase'][number % 3 + 1] AS event_type,
    toDecimal64(number % 100, 2) AS revenue
FROM numbers(1000000);
```

## How does a ClickHouse projection store data?

A projection stores its rows as a hidden sub-part inside every data part of the table, so it is written, merged and dropped together with the part it belongs to. An ordering projection keeps the selected columns in a different `ORDER BY`, which gives the table a second primary index.

The table is sorted by `event_time`, so a filter on `user_id` has to scan every granule:

```sql
EXPLAIN indexes = 1
SELECT count() FROM events WHERE user_id = 42;
```

```text
ReadFromMergeTree (default.events)
Indexes:
  PrimaryKey
    Condition: true
    Parts: 1/1
    Granules: 123/123
```

Add a projection sorted by `user_id` and build it for the existing part:

```sql
ALTER TABLE events ADD PROJECTION by_user
(
    SELECT * ORDER BY user_id
);

ALTER TABLE events MATERIALIZE PROJECTION by_user SETTINGS mutations_sync = 1;
```

The same query now reads 1 granule out of 123, from `by_user` (output trimmed to the read step):

```sql
EXPLAIN indexes = 1
SELECT count() FROM events WHERE user_id = 42;
```

```text
ReadFromMergeTree (by_user)
Indexes:
  PrimaryKey
    Keys:
      user_id
    Condition: (user_id in [42, 42])
    Parts: 1/1
    Granules: 1/123
    Search Algorithm: binary search
```

The projection's data shows up in `system.projection_parts`, attached to its parent part:

```sql
SELECT parent_name, name, rows, formatReadableSize(bytes_on_disk) AS size
FROM system.projection_parts
WHERE table = 'events' AND active;
```

```text
all_1_1_0_2	by_user	1000000	4.31 MiB
```

In `system.parts` the same part reports 12.07 MiB, because its `bytes_on_disk` includes the projection: 4.31 MiB of the 12.07 MiB is `by_user`. A `SELECT *` projection with a different sort key duplicates every column, which the docs also warn about ([ALTER PROJECTION](https://clickhouse.com/docs/sql-reference/statements/alter/projection)).

## How does a materialized view store data?

A materialized view stores its output in an ordinary table that you create and choose the engine for, and it fills that table by running its `SELECT` on each inserted block. Because it is a separate pipeline, it can join, filter and reshape data, none of which a projection definition allows:

```sql
CREATE TABLE users (user_id UInt32, country LowCardinality(String))
ENGINE = MergeTree ORDER BY user_id;

INSERT INTO users SELECT number, ['US', 'DE', 'IN'][number % 3 + 1] FROM numbers(50000);

CREATE TABLE daily_revenue_by_country
(
    day Date,
    country LowCardinality(String),
    purchases UInt64,
    revenue Decimal(38, 2)
)
ENGINE = SummingMergeTree
ORDER BY (day, country);

CREATE MATERIALIZED VIEW daily_revenue_by_country_mv TO daily_revenue_by_country AS
SELECT
    toDate(e.event_time) AS day,
    u.country AS country,
    count() AS purchases,
    sum(e.revenue) AS revenue
FROM events AS e
INNER JOIN users AS u ON e.user_id = u.user_id
WHERE e.event_type = 'purchase'
GROUP BY day, country;

INSERT INTO events
SELECT
    toDateTime('2026-03-01 00:00:00') + number * 3,
    number % 50000,
    ['view', 'click', 'purchase'][number % 3 + 1],
    toDecimal64(number % 100, 2)
FROM numbers(1000000);
```

Queries go to the target table, and still need `sum()` because `SummingMergeTree` only collapses rows when parts merge:

```sql
SELECT country, sum(purchases) AS purchases, sum(revenue) AS revenue
FROM daily_revenue_by_country
GROUP BY country
ORDER BY country;
```

```text
DE	100002	4950000
IN	116662	5774769
US	116669	5775231
```

The view only saw the second insert. The first 1,000,000 rows were already in `events` when the view was created, and a materialized view processes new inserts only. The [materialized views guide](/blog/a-guide-to-materialized-views-in-clickhouse) covers backfilling and why `POPULATE` loses data.

## Which queries can ClickHouse answer from a projection?

ClickHouse uses a projection only when the projection contains every column and expression the query needs and reading it is cheaper than reading the table. You never name the projection in the query; the optimizer decides per query, and `optimize_use_projections` (on by default) controls whether it tries at all.

For an ordering projection, the query's columns must all be in the projection. With a narrower projection, `PROJECTION by_user (SELECT user_id, event_time, event_type ORDER BY user_id)`, a query selecting `event_time, event_type ... WHERE user_id = 42` read from `by_user`, and the same query selecting `revenue` fell back to the base table.

An aggregate projection stores pre-aggregated rows per part. Add one to the table:

```sql
ALTER TABLE events ADD PROJECTION daily_by_type
(
    SELECT
        toDate(event_time),
        event_type,
        count(),
        sum(revenue),
        uniq(user_id)
    GROUP BY toDate(event_time), event_type
);

ALTER TABLE events MATERIALIZE PROJECTION daily_by_type SETTINGS mutations_sync = 1;
```

These are the queries we ran against it, and what `EXPLAIN` showed as the read step:

| Query | Read from |
|---|---|
| `SELECT toDate(event_time) AS day, event_type, count(), sum(revenue) ... GROUP BY day, event_type` | `daily_by_type` |
| `SELECT event_type, count() ... GROUP BY event_type` (subset of the keys) | `daily_by_type` |
| `SELECT count() ... WHERE event_type = 'purchase'` | `daily_by_type` |
| `SELECT toStartOfMonth(toDate(event_time)) AS m, count() ... GROUP BY m` | `daily_by_type` |
| `SELECT toDate(event_time) AS day, uniq(user_id) ... GROUP BY day` | `daily_by_type` |
| `... WHERE toDate(event_time) >= '2026-01-20' GROUP BY day` | `daily_by_type` |
| `... WHERE event_time >= '2026-01-20 00:00:00' GROUP BY day` | `events` |
| `SELECT event_type, avg(revenue) ... GROUP BY event_type` | `events` |
| `SELECT toDate(event_time) AS day, uniqExact(user_id) ... GROUP BY day` | `events` |
| `SELECT count() ... WHERE toHour(event_time) = 3` | `events` |

The pattern: filters and group keys must be expressible from the stored keys (`toDate(event_time)` works, raw `event_time` does not), and each aggregate must exist in the projection under the same function. `avg(revenue)` was not rewritten into `sum / count` even though both are stored.

To make a query fail unless a specific projection serves it, set `force_optimize_projection_name`:

```sql
SELECT event_type, avg(revenue)
FROM events
GROUP BY event_type
SETTINGS force_optimize_projection_name = 'daily_by_type';
```

```text
Code: 117. DB::Exception: Projection daily_by_type is specified in setting force_optimize_projection_name but not used. (INCORRECT_DATA)
```

The broader `force_optimize_projection = 1` only requires that some projection is used, and it changes the plan to satisfy that. With both projections on the table, this `avg` query ran without error under `force_optimize_projection = 1`, and `EXPLAIN` showed it reading the full-copy `by_user` projection instead of the base table. On a table with a single projection, a query that cannot use it fails with `Code: 584 ... (PROJECTION_NOT_USED)`.

On a server, `system.query_log` also has a `projections` column listing the projections each query used ([ALTER PROJECTION docs](https://clickhouse.com/docs/sql-reference/statements/alter/projection)). `clickhouse local` has no query log, so the checks here use `EXPLAIN` and the two `force_optimize_projection` settings.

## Aggregate projection vs ordering projection: which one do you need?

Use an ordering projection when queries filter on a column that is not a prefix of the table's `ORDER BY`, and an aggregate projection when queries repeatedly `GROUP BY` the same keys over many rows. `system.projections` shows which kind each one is:

```sql
SELECT name, type, sorting_key
FROM system.projections
WHERE table = 'events';
```

```text
by_user	Normal	['user_id']
daily_by_type	Aggregate	['toDate(event_time)','event_type']
```

An ordering projection with `SELECT *` costs roughly a second copy of the table. An aggregate projection is usually much smaller, but aggregate states are stored as states: in our test `daily_by_type` held 105 rows per part (35 days × 3 event types) and took 3.83 MiB per part, against 4.31 MiB for the full 1,000,000-row `by_user` copy. The same projection without the `uniq(user_id)` column took 690 bytes per part. Check `system.projection_parts` before assuming a rollup is free.

ClickHouse 25.5 and later can also store only the sort key plus the row's position in the part, which works like a secondary index and then reads the other columns from the base table ([Projections docs](https://clickhouse.com/docs/data-modeling/projections)). The syntax `PROJECTION by_user INDEX user_id TYPE basic` ran on 26.6 and the query above again read 1/123 granules.

## How do you add a projection to an existing table (MATERIALIZE PROJECTION)?

`ALTER TABLE ... ADD PROJECTION` only changes the table definition and applies to parts written afterwards; `ALTER TABLE ... MATERIALIZE PROJECTION` builds it for existing parts, as a mutation. The docs call adding a projection "lazy" for this reason ([ALTER PROJECTION](https://clickhouse.com/docs/sql-reference/statements/alter/projection)).

In a test where one part existed before `ADD PROJECTION` and one was inserted after, `system.projection_parts` listed `by_user` only for the newer part, and `EXPLAIN` showed a `Union` of a read from `events` (old part) and a read from `by_user` (new part). After `MATERIALIZE PROJECTION`, both parts had it, and `system.mutations` showed the command:

```sql
SELECT command, is_done FROM system.mutations WHERE table = 'events';
```

```text
(MATERIALIZE PROJECTION by_user)	1
(MATERIALIZE PROJECTION daily_by_type)	1
```

`SETTINGS mutations_sync = 1` makes the `ALTER` wait until the mutation completes on the current server; the default, `0`, runs it asynchronously ([mutations_sync](https://clickhouse.com/docs/operations/settings/settings#mutations_sync)). You can limit the build to one partition with `IN PARTITION`. `CLEAR PROJECTION` deletes the projection's files but keeps the definition, and `DROP PROJECTION` deletes both:

```sql
ALTER TABLE events ADD PROJECTION by_type (SELECT * ORDER BY event_type);
ALTER TABLE events DROP PROJECTION by_type;
```

## What do projections cost on inserts and storage?

Every insert writes the projection too, so insert work and disk usage grow with each projection. In one local run on a laptop, inserting 5,000,000 rows took 0.23 to 0.25 s into the plain table and 0.55 to 0.61 s into the same table with a `SELECT * ORDER BY user_id` projection. Those are two runs on one machine. The docs advise testing insert speed and storage overhead with your own data before deploying ([Projections docs](https://clickhouse.com/docs/data-modeling/projections)).

A materialized view also adds work to each insert, since its `SELECT` runs synchronously on the inserted block, and its target table takes its own disk space. The difference is control: you choose the target's engine, sort key and TTL, and you can make it far smaller than the source by filtering and aggregating.

## What are the limitations of projections?

Projections cannot be defined with a `JOIN`, `WHERE` or `FROM` clause, are skipped by `FINAL` queries, and need extra settings on ReplacingMergeTree tables and for lightweight deletes. Each point below was checked on 26.6 unless it cites the docs.

A projection definition takes only `SELECT ... [GROUP BY ...] [ORDER BY ...]`. Both of these failed with a syntax error, the parser stopping right after `FROM` and `WHERE`:

```sql
ALTER TABLE events ADD PROJECTION with_join
    (SELECT e.event_type, u.country FROM events e JOIN users u ON e.user_id = u.user_id);

ALTER TABLE events ADD PROJECTION purchases_only
    (SELECT * WHERE event_type = 'purchase' ORDER BY user_id);
```

Queries that contain joins can still use a projection for the table read. `SELECT u.country, count() FROM events AS e INNER JOIN users AS u ON e.user_id = u.user_id WHERE e.user_id = 42 GROUP BY u.country` read the `events` side from `by_user`.

On a `ReplacingMergeTree` table, creating a projection throws until you choose what merges do with it:

```text
Code: 344. DB::Exception: Projections are not supported for ReplacingMergeTree with deduplicate_merge_projection_mode = throw. Please set setting 'deduplicate_merge_projection_mode' to 'drop' or 'rebuild'. (SUPPORT_IS_DISABLED)
```

With `SETTINGS deduplicate_merge_projection_mode = 'rebuild'`, the table was created and a filtered `count()` used the projection, but the same query with `FINAL` read the base table, and `force_optimize_projection = 1` raised `PROJECTION_NOT_USED`. If your queries rely on [`FINAL` for deduplication](/blog/clickhouse-final-replacingmergetree-typescript), a projection will not speed them up.

Lightweight `DELETE FROM` is refused on tables with projections by default:

```text
Code: 344. DB::Exception: DELETE query is not allowed for table default.events because as it has projections and setting lightweight_mutation_projection_mode is set to THROW. ...
```

The MergeTree setting `lightweight_mutation_projection_mode` accepts `throw`, `drop` or `rebuild`. With `drop`, the delete removed the projection from the affected part and queries returned correct counts from the base table. With `rebuild`, our 26.6.2 test returned wrong results: after `DELETE FROM events WHERE user_id = 42`, the projection part still held 1,000,000 rows, and `count() ... WHERE user_id = 42` served from the projection returned 1000 while the base table returned 0. The projection was corrected after `OPTIMIZE TABLE events FINAL` merged the part. Classic `ALTER TABLE events DELETE WHERE user_id = 42` rebuilt the projection (999,000 rows) and returned 0. If you use lightweight deletes on a table with projections, test your version this way before relying on `rebuild`.

Two more limits come from the docs: a projection cannot have a different TTL from its table, and projections cannot be chained the way materialized views can ([Projections docs](https://clickhouse.com/docs/data-modeling/projections)).

`ALTER TABLE ... UPDATE` also kept projections in step: after updating `revenue` for one user, `sum(revenue)` read through `by_user` matched the base table.

Materialized views have the opposite problem with deletes. After `ALTER TABLE events DELETE WHERE toDate(event_time) = '2026-03-01'`, the source had 0 purchases for that day and `daily_revenue_by_country` still reported 9,600. A materialized view never sees updates or deletes on its source.

## Projection or materialized view: decision table

Pick a projection when the result is a re-sort or rollup of one table and the query should stay unchanged; pick a materialized view for anything that reshapes, joins, filters or chains data.

| You need | Use |
|---|---|
| Fast filters on a column that is not in the `ORDER BY` | Ordering projection (or `INDEX ... TYPE basic` projection) |
| `GROUP BY` the same keys with `count`, `sum`, `min`, `max`, `uniq` | Aggregate projection |
| Existing queries and BI tools to speed up without changes | Projection |
| Results to stay correct after `ALTER TABLE ... DELETE` or `UPDATE` | Projection |
| Data enriched with a `JOIN` | Materialized view |
| Only a subset of rows (`WHERE`) | Materialized view |
| A different TTL, engine or retention for the rollup | Materialized view |
| Hourly rollups feeding daily rollups | Materialized view (chained) |
| Queries that use `FINAL` | Not a projection: `FINAL` queries skip them |
| Lightweight deletes on the table | Materialized view, or a projection with `lightweight_mutation_projection_mode = 'drop'` |

For a scheduled full recompute instead of per-insert processing, ClickHouse also has refreshable materialized views; the [materialized views guide](/blog/a-guide-to-materialized-views-in-clickhouse) compares both kinds.

## Querying a table with projections from TypeScript

Because the optimizer picks projections on its own, application code queries the base table as usual and gets the faster plan when the query shape matches. With [hypequery's query builder](/clickhouse-query-builder):

```ts
import { createQueryBuilder, rawAs } from '@hypequery/clickhouse';
import type { IntrospectedSchema } from './schema';

const db = createQueryBuilder<IntrospectedSchema>({
  host: process.env.CLICKHOUSE_HOST!,
  username: process.env.CLICKHOUSE_USERNAME!,
  password: process.env.CLICKHOUSE_PASSWORD!,
  database: process.env.CLICKHOUSE_DATABASE!,
});

const rows = await db
  .table('events')
  .select([rawAs<string, 'day'>('toDate(event_time)', 'day'), 'event_type'])
  .count('event_type', 'events')
  .sum('revenue', 'revenue')
  .where((expr) => expr.raw("toDate(event_time) >= '2026-01-20'"))
  .groupBy(['day', 'event_type'])
  .execute();
// rows: { day: string; event_type: string; events: string; revenue: string }[]
```

This compiles to `SELECT toDate(event_time) AS day, event_type, COUNT(event_type) AS events, SUM(revenue) AS revenue FROM events WHERE toDate(event_time) >= '2026-01-20' GROUP BY day, event_type`. We ran that SQL with `force_optimize_projection_name = 'daily_by_type'` and it was served by the projection: ClickHouse rewrites `count(event_type)` on a non-Nullable column to `count()`, which the projection stores. Note the filter is on `toDate(event_time)`; a raw `.where('event_time', 'gte', ...)` would make ClickHouse read the base table, as the table above shows. The `count` and `sum` results are typed as `string` because hypequery asks ClickHouse to quote 64-bit integers in JSON.

## Related

- [A guide to materialized views in ClickHouse](/blog/a-guide-to-materialized-views-in-clickhouse)
- [View vs materialized view in ClickHouse](/blog/clickhouse-view-vs-materialized-view)
- [FINAL vs ReplacingMergeTree deduplication](/blog/clickhouse-final-replacingmergetree-typescript)
- [PREWHERE vs WHERE in ClickHouse](/blog/clickhouse-prewhere-vs-where)
- [ClickHouse query builder for TypeScript](/clickhouse-query-builder)
- [Real-time analytics on ClickHouse](/clickhouse-real-time-analytics)
- ClickHouse docs: [Projections](https://clickhouse.com/docs/data-modeling/projections), [ALTER TABLE ... PROJECTION](https://clickhouse.com/docs/sql-reference/statements/alter/projection), [CREATE VIEW](https://clickhouse.com/docs/sql-reference/statements/create/view)
