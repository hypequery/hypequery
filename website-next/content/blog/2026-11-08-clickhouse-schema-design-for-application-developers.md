---
title: "ClickHouse Schema Design for Application Developers"
description: "How to design ClickHouse tables for application analytics: sorting keys, partitions, column types, Map and JSON, deduplication without unique constraints, TTL and schema inspection, with queries checked on ClickHouse 26.6."
seoTitle: "ClickHouse Schema Design: ORDER BY, Types and Partitions"
seoDescription: "ClickHouse schema design starts with ORDER BY: put low-cardinality filter columns first, partition by month, avoid Nullable, and use the narrowest types."
pubDate: 2026-11-08
updatedAt: 2026-11-08
heroImage: ""
slug: clickhouse-schema-design-for-application-developers
status: published
tags:
  - ClickHouse
  - Schema Design
---

ClickHouse schema design is mostly about the `ORDER BY` clause of each MergeTree table: it decides how rows are sorted on disk and which granules a query can skip, so put the columns your queries filter on most, lowest cardinality first, at the front. After that, keep `PARTITION BY` coarse (usually by month), use the narrowest column types (`LowCardinality(String)`, small integers, non-`Nullable` columns), and handle uniqueness with `ReplacingMergeTree` because ClickHouse has no unique or foreign key constraints. Every query below was run on ClickHouse 26.6.

This guide is for developers adding analytics tables to an application. Migrations and TypeScript type generation are covered in [type-safe schema management for ClickHouse](/blog/type-safe-schema-management-clickhouse), and the [ClickHouse schema](/clickhouse-schema) page covers the hypequery side.

## What does a good ClickHouse schema look like?

A good ClickHouse schema for application analytics is one wide MergeTree table per event stream, sorted by the columns your queries filter on, with compact column types. Here is the `events` table the rest of this guide builds up to:

```sql
CREATE TABLE events
(
    tenant_id  UInt32,
    event_type LowCardinality(String),
    user_id    UInt64,
    created_at DateTime,
    properties Map(String, String),
    session_id Nullable(String)
)
ENGINE = MergeTree
PARTITION BY toYYYYMM(created_at)
ORDER BY (tenant_id, event_type, created_at)
TTL created_at + INTERVAL 1 YEAR;
```

| Decision | What it controls | Default to |
| --- | --- | --- |
| `ORDER BY` | Sort order on disk and the sparse primary index | 3 to 5 columns your queries filter on, low cardinality first |
| `PRIMARY KEY` | Which `ORDER BY` columns go into the index | Omit it; it then equals `ORDER BY` |
| `PARTITION BY` | How data is split into separately managed parts | `toYYYYMM(created_at)` or nothing |
| Column types | Storage size, memory, speed | Narrowest type that fits, no `Nullable` unless you need it |
| `TTL` | When old rows or column values are deleted | Your retention policy |

## How do you create a schema in ClickHouse?

In ClickHouse a "schema" is a database, so you create one with `CREATE DATABASE`. `CREATE SCHEMA app` returns a syntax error on 26.6.

```sql
CREATE DATABASE app;
SHOW DATABASES;
```

```text
INFORMATION_SCHEMA
app
default
information_schema
system
```

A MergeTree table requires an `ENGINE` and a sorting key. If you leave out `ORDER BY`, ClickHouse 26.6 does not fail: the setting `create_table_empty_primary_key_by_default` is `1` by default, so the table is created with `ORDER BY tuple()`, which means no primary index at all. With that setting turned off, you get the older error:

```text
Code: 36. DB::Exception: You must provide an ORDER BY or PRIMARY KEY expression in the table definition.
```

Check `SHOW CREATE TABLE` after creating a table to make sure you got the sorting key you meant.

## How do you choose ORDER BY and PRIMARY KEY in ClickHouse?

`ORDER BY` sets the order rows are stored in, and `PRIMARY KEY` sets which leading columns of that order go into the sparse index; if you only write `ORDER BY`, the primary key is the same columns. ClickHouse stores one index entry per granule (8,192 rows by default, from `index_granularity = 8192`), so the index lets a query skip whole granules whose key range cannot match the `WHERE` clause.

The primary key has to be a prefix of the sorting key:

```sql
CREATE TABLE t (a UInt32, b DateTime, c String)
ENGINE = MergeTree
PRIMARY KEY (b)
ORDER BY (a, b);
```

```text
Code: 36. DB::Exception: Primary key must be a prefix of the sorting key, but the column in the position 0 is a, not b. (BAD_ARGUMENTS)
```

`PRIMARY KEY (a) ORDER BY (a, b, c)` is valid: rows are sorted by all three columns, but only `a` is held in the index. Most application tables do not need this and can use `ORDER BY` alone.

The ClickHouse docs on [choosing a primary key](https://clickhouse.com/docs/best-practices/choosing-a-primary-key) say to "prioritize columns frequently used in query filters," especially those that exclude large numbers of rows, and that 4 to 5 key columns is typically sufficient. For a multi-tenant app that usually means `tenant_id` first, then a category such as `event_type`, then time. Sorting keys cannot include `Nullable` columns unless you enable `allow_nullable_key`:

```text
Code: 44. DB::Exception: Sorting key contains nullable columns, but merge tree setting `allow_nullable_key` is disabled. (ILLEGAL_COLUMN)
```

## How much less data does a good sorting key read?

A sorting key that matches the filter can cut the rows read by two orders of magnitude. This creates the same 2 million rows in two tables, one sorted by time only and one sorted by `(tenant_id, event_type, created_at)`:

```sql
CREATE TABLE events_by_time
(
    tenant_id  UInt32,
    event_type LowCardinality(String),
    user_id    UInt64,
    created_at DateTime
)
ENGINE = MergeTree
ORDER BY created_at;

CREATE TABLE events_by_tenant AS events_by_time
ENGINE = MergeTree
ORDER BY (tenant_id, event_type, created_at);

INSERT INTO events_by_time
SELECT
    number % 1000,
    ['page_view', 'click', 'signup', 'purchase'][number % 4 + 1],
    number % 50000,
    toDateTime('2026-01-01 00:00:00') + number * 15
FROM numbers(2000000);

INSERT INTO events_by_tenant SELECT * FROM events_by_time;

EXPLAIN ESTIMATE SELECT count() FROM events_by_time WHERE tenant_id = 42;
EXPLAIN ESTIMATE SELECT count() FROM events_by_tenant WHERE tenant_id = 42;
```

`EXPLAIN ESTIMATE` returns database, table, parts, rows and marks to read:

```text
default	events_by_time	2	2000000	245
default	events_by_tenant	2	16384	2
```

Both queries return 2,000. The time-sorted table reads all 2,000,000 rows; the tenant-sorted table reads 16,384 rows (2 granules). `EXPLAIN indexes = 1` shows why:

```sql
EXPLAIN indexes = 1 SELECT count() FROM events_by_tenant WHERE tenant_id = 42;
```

```text
        ReadFromMergeTree (default.events_by_tenant)
        Indexes:
          PrimaryKey
            Keys:
              tenant_id
            Condition: (tenant_id in [42, 42])
            Parts: 2/2
            Granules: 2/245
            Search Algorithm: binary search
```

The same plan for `events_by_time` shows `Condition: true` and `Granules: 245/245`: the index cannot help. You can turn this into a guard in production with `max_rows_to_read`. On the time-sorted table the query fails:

```sql
SELECT count() FROM events_by_time WHERE tenant_id = 42 SETTINGS max_rows_to_read = 100000;
```

```text
Code: 158. DB::Exception: Limit for rows or bytes to read exceeded, max rows: 100.00 thousand, current rows: 2.00 million ... (TOO_MANY_ROWS)
```

On `events_by_tenant`, the same query with the same limit returns `2000`.

## Why do low-cardinality columns go first in the sorting key?

Low-cardinality columns go first because a filter on a later key column can still skip granules only when the columns before it have few distinct values. The ClickHouse [sparse primary index guide](https://clickhouse.com/docs/guides/best-practices/sparse-primary-indexes) states it is "beneficial to order the columns in a primary key by their cardinality in ascending order", because the generic exclusion search used for non-leading columns "is most effective when the predecessor key column has low(er) cardinality."

Here `event_type` has 4 values and `user_id` has 50,000. Each table is queried on its second key column:

```sql
CREATE TABLE lowcard_first
(
    event_type LowCardinality(String),
    user_id    UInt64,
    created_at DateTime
)
ENGINE = MergeTree
ORDER BY (event_type, user_id);

CREATE TABLE highcard_first AS lowcard_first
ENGINE = MergeTree
ORDER BY (user_id, event_type);

INSERT INTO lowcard_first
SELECT
    ['page_view', 'click', 'signup', 'purchase'][number % 4 + 1],
    number % 50000,
    toDateTime('2026-01-01 00:00:00') + number * 15
FROM numbers(2000000);

INSERT INTO highcard_first SELECT * FROM lowcard_first;

EXPLAIN ESTIMATE SELECT count() FROM lowcard_first WHERE user_id = 123;
EXPLAIN ESTIMATE SELECT count() FROM highcard_first WHERE event_type = 'click';
```

```text
default	lowcard_first	2	73728	9
default	highcard_first	2	2000000	245
```

With `event_type` first, filtering on `user_id` alone reads 73,728 rows. With `user_id` first, filtering on `event_type` alone reads the whole table. Put the column that is in almost every `WHERE` clause first (often `tenant_id`), then other low-cardinality filters, then the timestamp.

## When should you use PARTITION BY in ClickHouse?

Use `PARTITION BY` for data management, such as dropping a month of data, and keep it coarse: `toYYYYMM(created_at)` or no partition key at all. The ClickHouse docs on [choosing a partitioning key](https://clickhouse.com/docs/best-practices/choosing-a-partitioning-key) call it "primarily a data management feature" and recommend fewer than 100 to 1,000 distinct values.

Over-partitioning hurts because every insert writes at least one part per partition it touches. Partitioning the 2 million rows above by day (348 distinct dates) fails on insert:

```sql
CREATE TABLE p (tenant_id UInt32, created_at DateTime)
ENGINE = MergeTree
PARTITION BY toDate(created_at)
ORDER BY (tenant_id, created_at);

INSERT INTO p
SELECT number % 1000, toDateTime('2026-01-01 00:00:00') + number * 15
FROM numbers(2000000);
```

```text
Code: 252. DB::Exception: Too many partitions for single INSERT block (more than 100). The limit is controlled by 'max_partitions_per_insert_block' setting. ... (TOO_MANY_PARTS)
```

The full error message adds that partitioning "is not intended to speed up SELECT queries (ORDER BY key is sufficient to make range queries fast)". Partitioning by `tenant_id` with 1,000 tenants and the limit lifted produced 1,000 partitions and 2,000 parts for 2 million rows, about 1,000 rows per part. The same data partitioned by `toYYYYMM` produced 12 partitions in 13 parts. ClickHouse starts delaying inserts at 1,000 active parts in a partition and rejects them at 3,000 (`parts_to_delay_insert` and `parts_to_throw_insert` on 26.6).

Monthly partitions still prune time ranges. A March query on the monthly table reads 1 of 13 parts and 22 of 245 granules.

## Which ClickHouse types should you use?

Use the smallest type that holds your values: `LowCardinality(String)` for repeated strings, `UInt8` to `UInt32` where the range fits, `DateTime` unless you need sub-second precision, and plain (non-`Nullable`) columns with a default value. Byte sizes checked with `byteSize()`:

| Type | Bytes per value | Use for |
| --- | --- | --- |
| `UInt8` / `UInt16` / `UInt32` / `UInt64` | 1 / 2 / 4 / 8 | Counts, ids, flags |
| `Date` | 2 | Calendar days |
| `DateTime` | 4 | Second precision, 1970-01-01 to 2106-02-07 |
| `DateTime64(3)` | 8 | Millisecond timestamps |
| `LowCardinality(String)` | Dictionary code plus shared dictionary | Event names, plans, countries |
| `Enum8` | 1 | A fixed, known list of values |

Storage for 2 million rows of a 4-value string column, from `system.columns`:

```sql
CREATE TABLE s
(
    plain String,
    lc    LowCardinality(String),
    nn    Nullable(String),
    en    Enum8('page_view' = 1, 'click' = 2, 'signup' = 3, 'purchase' = 4)
)
ENGINE = MergeTree
ORDER BY tuple();

INSERT INTO s
SELECT ['page_view', 'click', 'signup', 'purchase'][number % 4 + 1] AS v, v, v, v
FROM numbers(2000000);

OPTIMIZE TABLE s FINAL;

SELECT name,
       formatReadableSize(data_compressed_bytes) AS compressed,
       formatReadableSize(data_uncompressed_bytes) AS uncompressed
FROM system.columns
WHERE table = 's';
```

```text
plain	134.93 KiB	28.61 MiB
lc	9.58 KiB	1.91 MiB
nn	143.65 KiB	30.52 MiB
en	8.81 KiB	1.91 MiB
```

The uncompressed size matters because that is what queries process in memory. The [LowCardinality docs](https://clickhouse.com/docs/sql-reference/data-types/lowcardinality) say it is usually more efficient below 10,000 distinct values and can perform worse above 100,000, so don't use it for URLs or ids.

`Nullable` costs an extra null-mask stream: in `system.parts_columns` the `nn` column has substreams `nn.null`, `nn.size` and `nn`, and it is 1.91 MiB larger uncompressed than `plain` (one byte per row). The [Nullable docs](https://clickhouse.com/docs/sql-reference/data-types/nullable) say using it "almost always negatively affects performance". Without `Nullable`, a column you leave out of an insert gets the type's default: inserting only `id` into `(id UInt64, name String, score Nullable(Float64))` returns `{"id":1,"name":"","score":null}`.

`Enum8` rejects unknown values (`Code: 691 ... Unknown element 'paused' for enum`), and you add values later with `ALTER TABLE ... MODIFY COLUMN`. That is useful for statuses, but every new value is a schema change, so `LowCardinality(String)` is often easier for values your application adds over time.

Narrow integers do not reject out-of-range values. On 26.6, `INSERT INTO n VALUES (300)` into a `UInt8` column stores `44` (300 mod 256) with no error, so pick a width with headroom.

`DateTime` stores seconds; `toDateTime('2026-11-08 10:15:30.987', 'UTC')` returns `2026-11-08 10:15:30`, while `DateTime64(3)` keeps `.987`. Use `DateTime64` only when you need the fraction, since it is twice the size.

## How does the ClickHouse Map data type work?

`Map(K, V)` stores key-value pairs in one column, and `m['key']` returns the value or the value type's default when the key is missing. It suits sparse attributes such as event properties.

```sql
CREATE TABLE m (id UInt32, attrs Map(String, String))
ENGINE = MergeTree
ORDER BY id;

INSERT INTO m VALUES (1, {'plan': 'pro', 'region': 'eu'}), (2, {'plan': 'free'});

SELECT id, attrs['plan'] AS plan, attrs['region'] AS region,
       mapKeys(attrs) AS keys, mapContains(attrs, 'region') AS has_region
FROM m
ORDER BY id;
```

```text
1	pro	eu	['plan','region']	1
2	free		['plan']	0
```

Row 2 returns an empty string for `region`, so use `mapContains` when "missing" and "empty" differ. The `JSON` type is the alternative for nested, semi-structured payloads: `payload.billing.currency` reads a nested path, paths are returned as `Dynamic`, and a missing path returns `NULL`. `JSONAllPathsWithTypes` showed `seats` stored as `Int64` and `plan` as `String` for the row `{"plan":"pro","seats":12,"billing":{"currency":"EUR"}}`. Any key you filter on in most queries is better as its own typed column, where it can go in the sorting key.

## Does ClickHouse support foreign keys or unique constraints?

No. ClickHouse does not enforce foreign keys or unique constraints. On 26.6 a `FOREIGN KEY (user_id) REFERENCES users(id)` clause is accepted and dropped: `SHOW CREATE TABLE` no longer contains it. `UNIQUE` on a column is a syntax error, and two inserts with the same `ORDER BY` value both stay in a `MergeTree` table.

What to use instead:

- `ReplacingMergeTree(version)` for rows that get updated, such as users or subscriptions. Duplicates by sorting key are collapsed during merges, keeping the highest version.
- `FINAL` or `argMax` when you need deduplicated results before a merge has happened.
- Dictionaries for small lookup tables you would otherwise join on.
- `CONSTRAINT ... CHECK` for row-level validation, which ClickHouse does enforce on insert.

```sql
CREATE TABLE users
(
    id         UInt64,
    email      String,
    plan       LowCardinality(String),
    updated_at DateTime
)
ENGINE = ReplacingMergeTree(updated_at)
ORDER BY id;

INSERT INTO users VALUES (1, 'a@example.com', 'free', '2026-11-01 09:00:00');
INSERT INTO users VALUES (1, 'a@example.com', 'pro', '2026-11-05 12:00:00');

SELECT count() FROM users;
SELECT * FROM users FINAL;
```

```text
2
1	a@example.com	pro	2026-11-05 12:00:00
```

The two rows stay separate until a merge, which is why `count()` returns 2. [FINAL and ReplacingMergeTree](/blog/clickhouse-final-replacingmergetree-typescript) covers the read-side trade-offs. For lookups, a dictionary built from a table:

```sql
CREATE TABLE plans (plan_id UInt8, name String, monthly_price Decimal(10, 2))
ENGINE = MergeTree
ORDER BY plan_id;

INSERT INTO plans VALUES (1, 'free', 0), (2, 'pro', 49), (3, 'enterprise', 499);

CREATE DICTIONARY plans_dict (plan_id UInt64, name String, monthly_price Decimal(10, 2))
PRIMARY KEY plan_id
SOURCE(CLICKHOUSE(TABLE 'plans'))
LAYOUT(FLAT())
LIFETIME(MIN 300 MAX 600);

CREATE TABLE subscriptions (tenant_id UInt32, plan_id UInt8)
ENGINE = MergeTree
ORDER BY tenant_id;

INSERT INTO subscriptions VALUES (10, 2), (11, 3), (12, 9);

SELECT tenant_id,
       dictGet('plans_dict', 'name', plan_id) AS plan,
       dictHas('plans_dict', plan_id) AS known
FROM subscriptions
ORDER BY tenant_id;
```

```text
10	pro	1
11	enterprise	1
12		0
```

Plan 9 does not exist, and nothing stopped the insert. `dictHas` is how you find orphaned references. A check constraint does block bad rows:

```sql
CREATE TABLE orders (id UInt64, amount Decimal(18, 2), CONSTRAINT amount_positive CHECK amount >= 0)
ENGINE = MergeTree
ORDER BY id;

INSERT INTO orders VALUES (1, -5);
```

```text
Code: 469. DB::Exception: Constraint `amount_positive` for table default.orders (...) is violated at row 1. Expression: (amount >= 0). Column values: amount = '-5'. (VIOLATED_CONSTRAINT)
```

## How do you expire old data with TTL?

A table-level `TTL` deletes rows once the expression is in the past, and a column-level `TTL` resets just that column to its default. Expired data is removed when parts merge, so it can still be visible for a while after it expires.

```sql
CREATE TABLE logs
(
    created_at    DateTime,
    message       String,
    debug_payload String TTL created_at + INTERVAL 7 DAY
)
ENGINE = MergeTree
ORDER BY created_at
TTL created_at + INTERVAL 90 DAY;

INSERT INTO logs VALUES
    (now() - INTERVAL 200 DAY, 'old', 'x'),
    (now() - INTERVAL 30 DAY, 'month', 'y'),
    (now(), 'new', 'z');

OPTIMIZE TABLE logs FINAL;
SELECT message, debug_payload FROM logs ORDER BY created_at;
```

```text
month
new	z
```

Before the `OPTIMIZE`, all three rows were returned with their payloads. `ALTER TABLE logs MODIFY TTL created_at + INTERVAL 90 DAY` on an existing table applied the new TTL to existing rows straight away in the same test.

## What is a materialized column in ClickHouse?

A `MATERIALIZED` column is computed from other columns at insert time and stored on disk. It is left out of `SELECT *` and you cannot insert into it directly (`Cannot insert column domain, because it is MATERIALIZED column`).

```sql
CREATE TABLE page_views (created_at DateTime, url String)
ENGINE = MergeTree
ORDER BY created_at;

INSERT INTO page_views
SELECT toDateTime('2026-01-01 00:00:00') + number,
       concat('https://site', toString(number % 100), '.com/p/', toString(number))
FROM numbers(1000000);

ALTER TABLE page_views ADD COLUMN domain LowCardinality(String) MATERIALIZED domain(url);
ALTER TABLE page_views MATERIALIZE COLUMN domain SETTINGS mutations_sync = 1;
```

Adding the column only changes metadata. Older parts compute `domain` at read time until you run `ALTER TABLE ... MATERIALIZE COLUMN`, which writes it into existing parts as a mutation; `system.parts_columns` listed only `created_at` and `url` before it and `domain` after. `mutations_sync = 1` makes the `ALTER` wait for the mutation to finish.

Data-skipping indexes work the same way. `ADD INDEX` applies to new inserts, and `MATERIALIZE INDEX` builds it for existing data:

```sql
CREATE TABLE visits (created_at DateTime, user_id UInt64)
ENGINE = MergeTree
ORDER BY created_at;

INSERT INTO visits
SELECT toDateTime('2026-01-01 00:00:00') + number, number % 100000
FROM numbers(2000000);

ALTER TABLE visits ADD INDEX idx_user user_id TYPE bloom_filter GRANULARITY 1;
ALTER TABLE visits MATERIALIZE INDEX idx_user SETTINGS mutations_sync = 1;

EXPLAIN indexes = 1 SELECT count() FROM visits WHERE user_id = 4242;
```

Before `MATERIALIZE INDEX` the skip index section showed `Granules: 245/245`; after, `Granules: 22/245`. Use skip indexes for columns you filter on that are not in the sorting key.

## How do you show a table schema in ClickHouse?

`SHOW CREATE TABLE events` returns the full DDL, including engine, sorting key, partition key and TTL, and `DESCRIBE TABLE events` lists columns and types. For the `events` table at the top of this guide:

```sql
SHOW CREATE TABLE events FORMAT TSVRaw;
```

```text
CREATE TABLE default.events
(
    `tenant_id` UInt32,
    `event_type` LowCardinality(String),
    `user_id` UInt64,
    `created_at` DateTime,
    `properties` Map(String, String),
    `session_id` Nullable(String)
)
ENGINE = MergeTree
PARTITION BY toYYYYMM(created_at)
ORDER BY (tenant_id, event_type, created_at)
TTL created_at + toIntervalYear(1)
SETTINGS index_granularity = 8192
```

`FORMAT TSVRaw` prints real newlines; the default format escapes them as `\n`. To query schemas, `system.columns` shows which key each column belongs to:

```sql
SELECT name, type, is_in_partition_key, is_in_sorting_key, is_in_primary_key
FROM system.columns
WHERE database = 'default' AND table = 'events';
```

```text
tenant_id	UInt32	0	1	1
event_type	LowCardinality(String)	0	1	1
user_id	UInt64	0	0	0
created_at	DateTime	1	1	1
properties	Map(String, String)	0	0	0
session_id	Nullable(String)	0	0	0
```

`information_schema` gives the standard SQL view, which is handy for tools that already speak it:

```sql
SELECT column_name, data_type, is_nullable
FROM information_schema.columns
WHERE table_schema = 'default' AND table_name = 'events';
```

`is_nullable` comes back as `1` only for `session_id`. `system.tables` has the keys as text, in its `partition_key`, `sorting_key` and `primary_key` columns, and `SHOW COLUMNS FROM events` marks key columns as `PRI SOR`.

## How do ClickHouse types map to TypeScript in hypequery?

hypequery generates TypeScript types from `DESCRIBE TABLE` output, so your column type choices show up directly in application code. `npx @hypequery/cli generate --output ./src/schema.ts` writes an `IntrospectedSchema` for the query builder and a record type per table. For the `events` table:

```ts
export interface EventsRecord {
  'tenant_id': number;               // UInt32
  'event_type': string;              // LowCardinality(String)
  'user_id': string;                 // UInt64
  'created_at': string;              // DateTime
  'properties': Record<string, string>; // Map(String, String)
  'session_id': string | null;       // Nullable(String)
}
```

The rules: `Int8` to `Int32` and `UInt8` to `UInt32` become `number`; `Int64`, `UInt64` and wider become `string`, because hypequery asks ClickHouse to quote 64-bit integers in JSON (`output_format_json_quote_64bit_integers = 1` returns `{"id":"42"}`); floats and decimals are `number`; dates are `string`; `LowCardinality(T)` is just `T`; `Nullable(T)` adds `| null`; `Enum8` is `string`; `Map(K, V)` is `Record<string, V>`; `Array(T)` is `T[]`.

This feeds back into type choice. If a value fits in `UInt32`, using `UInt32` gives you a `number` in TypeScript instead of a string you must parse. Avoiding `Nullable` removes a `null` check from every consumer. `count()` returns `UInt64`, so counts arrive as strings:

```ts
import { createQueryBuilder } from '@hypequery/clickhouse';
import type { IntrospectedSchema } from './schema';

const db = createQueryBuilder<IntrospectedSchema>({
  host: process.env.CLICKHOUSE_HOST!,
  username: process.env.CLICKHOUSE_USERNAME!,
  password: process.env.CLICKHOUSE_PASSWORD!,
  database: process.env.CLICKHOUSE_DATABASE!,
});

const rows = await db
  .table('events')
  .select(['event_type'])
  .count('user_id', 'events')
  .where('tenant_id', 'eq', 42)
  .where((expr) => expr.raw('created_at >= now() - INTERVAL 7 DAY'))
  .groupBy('event_type')
  .execute();

const total = rows.reduce((sum, row) => sum + Number(row.events), 0);
```

Because the filter is on `tenant_id`, this query uses the sorting key from earlier in the guide.

## Related

- [Type-safe schema management in ClickHouse](/blog/type-safe-schema-management-clickhouse)
- [ClickHouse schema with hypequery](/clickhouse-schema)
- [ClickHouse FINAL and ReplacingMergeTree](/blog/clickhouse-final-replacingmergetree-typescript)
- [ClickHouse PREWHERE vs WHERE](/blog/clickhouse-prewhere-vs-where)
- [Multi-tenant analytics on ClickHouse](/clickhouse-multi-tenant-analytics)
- ClickHouse docs: [Choosing a primary key](https://clickhouse.com/docs/best-practices/choosing-a-primary-key), [Sparse primary indexes](https://clickhouse.com/docs/guides/best-practices/sparse-primary-indexes), [Choosing a partitioning key](https://clickhouse.com/docs/best-practices/choosing-a-partitioning-key), [LowCardinality](https://clickhouse.com/docs/sql-reference/data-types/lowcardinality), [Nullable](https://clickhouse.com/docs/sql-reference/data-types/nullable)
