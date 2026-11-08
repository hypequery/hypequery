---
title: "ClickHouse Equivalents of Common Postgres and MySQL SQL"
description: "A lookup table of ClickHouse equivalents for GROUP_CONCAT, string_agg, unnest, date_trunc, CASE, ILIKE, DISTINCT ON, percentile_cont, ON CONFLICT, UPDATE and more, with the outputs that differ from Postgres and MySQL. Every query was run on ClickHouse 26.6."
seoTitle: "ClickHouse GROUP_CONCAT, date_trunc, CASE: SQL Equivalents"
seoDescription: "ClickHouse GROUP_CONCAT is groupConcat(',')(x), unnest is arrayJoin, date_trunc returns Date for month. Postgres and MySQL equivalents, checked on 26.6."
pubDate: 2026-11-08
updatedAt: 2026-11-08
heroImage: ""
slug: postgres-mysql-to-clickhouse-sql-equivalents
status: published
tags:
  - ClickHouse
  - SQL
---

Most Postgres and MySQL analytics SQL runs on ClickHouse with small changes: `GROUP_CONCAT` and `string_agg` become `groupConcat(',')(x)`, `unnest` becomes `arrayJoin` or `ARRAY JOIN`, `CASE WHEN` works as written, and `date_trunc` exists but returns a `Date` for month and week. The changes that silently alter results are elsewhere: `7 / 2` returns `3.5` as `Float64`, `LIKE` is case-sensitive, `group_concat` with no delimiter joins with an empty string, and there is no `ON CONFLICT`, so upserts become `ReplacingMergeTree` plus `FINAL`. Every ClickHouse query on this page was run on ClickHouse 26.6.2.

## ClickHouse SQL equivalents table

The table maps the Postgres and MySQL form to the ClickHouse form. The sections after it show real output for the rows that behave differently.

| Task | Postgres | MySQL | ClickHouse | Note |
|---|---|---|---|---|
| Join strings in a group | `string_agg(s, ',')` | `GROUP_CONCAT(s)` | `groupConcat(',')(s)` or `arrayStringConcat(groupArray(s), ',')` | `string_agg` and `group_concat` are aliases; default delimiter is `''` |
| Collect values into an array | `array_agg(x)` | `JSON_ARRAYAGG(x)` | `groupArray(x)` | `array_agg` is an alias of `groupArray` |
| Array to rows | `unnest(arr)` | `JSON_TABLE(...)` | `arrayJoin(arr)` or `ARRAY JOIN arr` | `unnest` is an alias of `arrayJoin`; empty arrays drop the row |
| Truncate to month | `date_trunc('month', ts)` | `DATE_FORMAT(ts, '%Y-%m-01')` | `toStartOfMonth(ts)` or `date_trunc('month', ts)` | Returns `Date` |
| NULL fallback | `COALESCE(a, b)` | `IFNULL(a, b)` | `ifNull(a, b)` or `coalesce(a, b)` | Same semantics |
| Conditional | `CASE WHEN ... END` | `IF(c, a, b)` | `CASE`, `if(c, a, b)`, `multiIf(c1, a, c2, b, c)` | All three work |
| Conditional count | `count(*) FILTER (WHERE c)` | `SUM(c)` | `countIf(c)`, `sumIf(x, c)` | `FILTER (WHERE ...)` also works |
| String to array | `string_to_array(s, ',')` | none | `splitByChar(',', s)` | Separator comes first; `splitByString` for multi-char |
| Nth part of a string | `split_part(s, ',', 2)` | `SUBSTRING_INDEX(...)` | `splitByChar(',', s)[2]` | Arrays are 1-based; `[0]` returns `''` |
| Pagination | `LIMIT 10 OFFSET 20` | `LIMIT 20, 10` | Both forms | Same results |
| First row per group | `DISTINCT ON (k)` | `ROW_NUMBER()` subquery | `LIMIT 1 BY k` or `DISTINCT ON (k)` | Both respect `ORDER BY` |
| Case-insensitive match | `ILIKE` | `LIKE` (default collation) | `ILIKE` | `LIKE` is case-sensitive |
| Substring contains | `position('x' in s) > 0` | `LOCATE('x', s) > 0` | `position(s, 'x') > 0` or `s LIKE '%x%'` | Haystack comes first |
| Array contains | `'x' = ANY(arr)` | `JSON_CONTAINS(...)` | `has(arr, 'x')` | `hasAny`, `hasAll` for sets |
| Range filter | `BETWEEN a AND b` | `BETWEEN a AND b` | `BETWEEN a AND b` | Inclusive at both ends |
| Distinct count | `COUNT(DISTINCT x)` | `COUNT(DISTINCT x)` | `count(DISTINCT x)`, `uniqExact(x)`, `uniq(x)` | `uniq` is approximate |
| Median / percentile | `percentile_cont(0.9) WITHIN GROUP (ORDER BY x)` | none built in | `quantileExactInclusive(0.9)(x)` or `quantile(0.9)(x)` | `quantile` is approximate |
| Row number | `row_number() OVER (...)` | `ROW_NUMBER() OVER (...)` | `row_number() OVER (...)` | Same |
| Previous row | `lag(x) OVER (...)` | `LAG(x) OVER (...)` | `lag(x)` or `lagInFrame(x)` | First row returns `0` for non-Nullable columns (Postgres: NULL) |
| Upsert | `INSERT ... ON CONFLICT DO UPDATE` | `INSERT ... ON DUPLICATE KEY UPDATE` | `ReplacingMergeTree` + plain `INSERT` + `FINAL` | No `ON CONFLICT` syntax |
| Update rows | `UPDATE t SET ...` | `UPDATE t SET ...` | `ALTER TABLE t UPDATE ...` or lightweight `UPDATE` | Lightweight `UPDATE` needs two table settings |
| Delete rows | `DELETE FROM t WHERE ...` | `DELETE FROM t WHERE ...` | `DELETE FROM t WHERE ...` or `ALTER TABLE t DELETE ...` | Rows are masked, removed at merge |
| Foreign keys | `REFERENCES` | `FOREIGN KEY` | none | Table-level `FOREIGN KEY` is accepted and dropped |
| JSON field | `data->>'plan'` | `data->>'$.plan'` | `JSONExtractString(data, 'plan')` or `data.plan` on a `JSON` column | No `->>` operator |
| Relative time | `now() - INTERVAL '7 days'` | `NOW() - INTERVAL 7 DAY` | `now() - INTERVAL 7 DAY` | Both interval forms parse |
| Integer division | `7 / 2` → `3` | `7 DIV 2` → `3` | `intDiv(7, 2)` or `7 DIV 2` | `7 / 2` → `3.5` (`Float64`) |

The examples below use this table.

```sql
CREATE TABLE orders
(
    id UInt32,
    customer String,
    status String,
    amount Float64,
    coupon Nullable(String),
    tags Array(String),
    created_at DateTime
)
ENGINE = MergeTree
ORDER BY id;

INSERT INTO orders VALUES
    (1, 'acme',      'paid',     120.5, 'FALL10', ['gift', 'rush'], '2026-11-01 09:15:00'),
    (2, 'acme',      'refunded', 40,    NULL,     ['rush'],         '2026-11-01 17:40:00'),
    (3, 'globex',    'paid',     99.99, NULL,     [],               '2026-11-02 08:05:00'),
    (4, 'globex',    'paid',     15,    '',       ['bulk'],         '2026-11-03 00:00:00'),
    (5, 'initech',   'pending',  60,    NULL,     ['gift', 'bulk'], '2026-11-03 23:59:59'),
    (6, 'Acme Corp', 'paid',     75,    NULL,     [],               '2026-11-04 10:00:00');
```

## What is the ClickHouse equivalent of GROUP_CONCAT?

The ClickHouse equivalent of MySQL `GROUP_CONCAT` and Postgres `string_agg` is `groupConcat(',')(column)`, or `arrayStringConcat(groupArray(column), ',')`. `group_concat` and `string_agg` are registered as aliases of `groupConcat`, and `array_agg` is an alias of `groupArray`.

```sql
SELECT
    customer,
    groupConcat(', ')(status) AS statuses,
    arrayStringConcat(groupArray(status), ', ') AS same_thing,
    groupArray(id) AS ids
FROM orders
GROUP BY customer
ORDER BY customer;
```

```text
Acme Corp   paid             paid             [6]
acme        paid, refunded   paid, refunded   [1,2]
globex      paid, paid       paid, paid       [3,4]
initech     pending          pending          [5]
```

The trap is the default delimiter. MySQL's `GROUP_CONCAT` defaults to a comma ([MySQL docs](https://dev.mysql.com/doc/refman/8.4/en/aggregate-functions.html#function_group-concat)). ClickHouse's defaults to an empty string ([groupConcat docs](https://clickhouse.com/docs/sql-reference/aggregate-functions/reference/groupconcat)):

```sql
SELECT group_concat(status) AS no_delimiter FROM orders WHERE customer = 'globex';
```

```text
paidpaid
```

MySQL's `GROUP_CONCAT(x ORDER BY y SEPARATOR ',')` and Postgres's `string_agg(x, ',' ORDER BY y)` are both syntax errors in ClickHouse 26.6. To control the order, collect tuples, sort them, then join:

```sql
SELECT
    customer,
    arrayStringConcat(arrayMap(t -> t.2, arraySort(groupArray((created_at, status)))), ',') AS statuses_in_time_order
FROM orders
GROUP BY customer
ORDER BY customer;
```

More on `groupArray` variants is on the [groupArray reference](/clickhouse/functions/group-array).

## How do you explode an array into rows in ClickHouse?

Use `arrayJoin(arr)` in the `SELECT` list, or the `ARRAY JOIN` clause, to turn each array element into its own row. `unnest` is an alias of `arrayJoin` in 26.6, so Postgres `SELECT unnest(tags)` also runs.

```sql
SELECT id, arrayJoin(tags) AS tag FROM orders ORDER BY id, tag;
```

```text
1   gift
1   rush
2   rush
4   bulk
5   bulk
5   gift
```

Orders 3 and 6 have empty arrays and disappear. `LEFT ARRAY JOIN` keeps them with an empty string as the tag:

```sql
SELECT id, tag
FROM orders
LEFT ARRAY JOIN tags AS tag
ORDER BY id, tag;
```

```text
1   gift
1   rush
2   rush
3
4   bulk
5   bulk
5   gift
6
```

The [ARRAY JOIN guide](/blog/clickhouse-array-join-typescript) covers multiple arrays and joining arrays in parallel.

## How do you convert a string to an array in ClickHouse?

`splitByChar(',', s)` splits a string on a single-byte separator and returns `Array(String)`. Use `splitByString` for multi-character separators and `splitByRegexp` for patterns. The separator is the first argument, the reverse of Postgres `string_to_array(s, ',')`.

```sql
SELECT
    splitByChar(',', 'red,green,,blue') AS parts,
    splitByString(', ', 'red, green, blue') AS parts2,
    splitByChar(',', 'red,green,blue')[2] AS second,
    splitByChar(',', 'red,green,blue')[0] AS zeroth;
```

```text
['red','green','','blue']   ['red','green','blue']   green
```

Arrays are 1-indexed, and index `0` returns the type's default (an empty string here) instead of an error. `splitByChar(', ', s)` fails with `Illegal separator for function splitByChar. Must be exactly one byte`. Wrap the result in `arrayJoin` to get one row per part.

## Does ClickHouse have date_trunc?

Yes. ClickHouse has `date_trunc(unit, value)` (alias of `dateTrunc`, case-insensitive), alongside `toStartOfMonth`, `toStartOfDay`, `toStartOfHour` and `toStartOfInterval`. The return type depends on the unit: `year`, `quarter`, `month` and `week` return `Date`, while `day`, `hour`, `minute` and `second` return `DateTime` ([dateTrunc docs](https://clickhouse.com/docs/sql-reference/functions/date-time-functions#date_trunc)).

```sql
SELECT
    date_trunc('month', toDateTime('2026-11-08 14:30:00')) AS dt_month,
    toTypeName(dt_month) AS month_type,
    date_trunc('day', toDateTime('2026-11-08 14:30:00')) AS dt_day,
    toTypeName(dt_day) AS day_type,
    date_trunc('week', toDateTime('2026-11-08 14:30:00')) AS dt_week,
    toStartOfWeek(toDateTime('2026-11-08 14:30:00')) AS start_of_week_mode0,
    toStartOfWeek(toDateTime('2026-11-08 14:30:00'), 1) AS start_of_week_mode1
FORMAT Vertical;
```

```text
dt_month:            2026-11-01
month_type:          Date
dt_day:              2026-11-08 00:00:00
day_type:            DateTime
dt_week:             2026-11-02
start_of_week_mode0: 2026-11-08
start_of_week_mode1: 2026-11-02
```

2026-11-08 is a Sunday. `date_trunc('week', ...)` returned Monday 2026-11-02, the same as Postgres, but `toStartOfWeek` with its default mode returned the Sunday itself. Pass mode `1` (or use `toMonday`) when porting Postgres weekly reports. For buckets like 15 minutes, use `toStartOfInterval(ts, INTERVAL 15 MINUTE)`; see [toStartOfInterval](/clickhouse/functions/to-start-of-interval) and [toStartOfWeek](/clickhouse/functions/to-start-of-week).

`now()` returns `DateTime`, `now64(3)` returns `DateTime64(3)`, and `today()` returns `Date`. Both MySQL-style `INTERVAL 7 DAY` and Postgres-style `INTERVAL '1 day 2 hours'` parse:

```sql
SELECT
    toDateTime('2026-11-08 14:30:00') - INTERVAL 7 DAY AS week_ago,
    toDateTime('2026-11-08 14:30:00') - INTERVAL '1 day 2 hours' AS pg_style,
    toDate('2026-01-31') + INTERVAL 1 MONTH AS month_end,
    dateDiff('day', toDate('2026-11-01'), toDate('2026-11-08')) AS days;
```

```text
2026-11-01 14:30:00   2026-11-07 12:30:00   2026-02-28   7
```

## How do you write CASE WHEN and IF in ClickHouse?

`CASE WHEN ... THEN ... ELSE ... END` works unchanged in ClickHouse. `if(cond, then, else)` is the two-branch form (like MySQL `IF`), and `multiIf(c1, r1, c2, r2, else)` is the compact form of a multi-branch `CASE`. For conditional aggregates, use the `-If` combinators such as `countIf` and `sumIf`; Postgres `FILTER (WHERE ...)` also runs.

```sql
SELECT
    id,
    amount,
    CASE WHEN amount >= 100 THEN 'large' WHEN amount >= 50 THEN 'medium' ELSE 'small' END AS size_case,
    multiIf(amount >= 100, 'large', amount >= 50, 'medium', 'small') AS size_multiif,
    if(status = 'paid', amount, 0) AS paid_amount
FROM orders
ORDER BY id;

SELECT
    countIf(status = 'paid') AS paid_orders,
    sumIf(amount, status = 'paid') AS paid_revenue,
    count() FILTER (WHERE status = 'paid') AS paid_orders_filter
FROM orders;
```

```text
1   120.5   large    large    120.5
2   40      small    small    0
3   99.99   medium   medium   99.99
4   15      small    small    15
5   60      medium   medium   0
6   75      medium   medium   75

4   310.49   4
```

A `CASE` with no `ELSE` returns `Nullable` (`Nullable(String)` in our test), with NULL for unmatched rows. See [if](/clickhouse/functions/if), [multiIf](/clickhouse/functions/multi-if) and [sumIf](/clickhouse/functions/sum-if).

## How does ifNull work in ClickHouse?

`ifNull(x, fallback)` returns `fallback` when `x` is NULL, the same as MySQL `IFNULL`; `coalesce` takes any number of arguments, and `nullIf(x, y)` returns NULL when they are equal. An empty string is not NULL, so combine `nullIf` and `coalesce` to treat both as missing:

```sql
SELECT
    id,
    coupon,
    ifNull(coupon, 'none') AS with_ifnull,
    coalesce(nullIf(coupon, ''), 'none') AS empty_as_none
FROM orders
ORDER BY id;
```

```text
1   FALL10   FALL10   FALL10
2   \N       none     none
3   \N       none     none
4                     none
5   \N       none     none
6   \N       none     none
```

The result type of `ifNull(coupon, 'none')` is `String`, so the column is no longer `Nullable`. More on [coalesce](/clickhouse/functions/coalesce).

## Is ClickHouse LIKE case-sensitive?

Yes. ClickHouse `LIKE` and `NOT LIKE` are case-sensitive, and `ILIKE` / `NOT ILIKE` are the case-insensitive versions ([string search docs](https://clickhouse.com/docs/sql-reference/functions/string-search-functions)). This matters when porting from MySQL, where `LIKE` is case-insensitive under the default `utf8mb4_0900_ai_ci` collation ([MySQL docs](https://dev.mysql.com/doc/refman/8.4/en/case-sensitivity.html)). `%` matches any run of characters, `_` matches one, and `\` escapes them.

```sql
SELECT
    customer,
    customer LIKE 'acme%' AS like_match,
    customer ILIKE 'acme%' AS ilike_match,
    customer NOT ILIKE 'acme%' AS not_ilike_match,
    position(customer, 'Corp') AS pos
FROM orders
WHERE id IN (1, 3, 6)
ORDER BY id;
```

```text
acme        1   1   0   0
globex      0   0   1   0
Acme Corp   0   1   0   6
```

For "contains" on a string, `position(haystack, needle)` returns the 1-based byte position or `0`, and `positionCaseInsensitive` ignores case. For "contains" on an array, use `has`:

```sql
SELECT id, tags, has(tags, 'gift') AS has_gift, hasAny(tags, ['gift', 'bulk']) AS any_of, hasAll(tags, ['gift', 'bulk']) AS all_of
FROM orders
ORDER BY id;
```

```text
1   ['gift','rush']   1   1   0
2   ['rush']          0   0   0
3   []                0   0   0
4   ['bulk']          0   1   0
5   ['gift','bulk']   1   1   1
6   []                0   0   0
```

## Is BETWEEN inclusive in ClickHouse?

Yes. ClickHouse docs define `a BETWEEN b AND c` as `a >= b AND a <= c`, so both ends are included ([operators docs](https://clickhouse.com/docs/sql-reference/operators)). The surprise with timestamps is the upper bound: a date string compared with a `DateTime` becomes midnight, so the last day is cut off.

```sql
SELECT id, created_at
FROM orders
WHERE created_at BETWEEN '2026-11-01' AND '2026-11-03'
ORDER BY id;
```

```text
1   2026-11-01 09:15:00
2   2026-11-01 17:40:00
3   2026-11-02 08:05:00
4   2026-11-03 00:00:00
```

Order 4 at exactly `00:00:00` is included, which shows the bound is inclusive, but order 5 at `23:59:59` the same day is excluded. Filter on `toDate(created_at) BETWEEN '2026-11-01' AND '2026-11-03'` or use a half-open range (`created_at >= '2026-11-01' AND created_at < '2026-11-04'`); both return all five November 1 to 3 orders. `3 BETWEEN 4 AND 2` returns `0`, so put the lower bound first.

## LIMIT, OFFSET and DISTINCT ON in ClickHouse

ClickHouse accepts `LIMIT 2 OFFSET 2`, MySQL's `LIMIT 2, 2` and `OFFSET 2 ROWS FETCH NEXT 2 ROWS ONLY`; all three returned ids 3 and 4. For deep pagination, keyset pagination scales better; see [ClickHouse pagination](/blog/clickhouse-pagination-typescript).

For Postgres `DISTINCT ON`, the ClickHouse idiom is `LIMIT n BY`, which keeps the first `n` rows per key after `ORDER BY`. ClickHouse 26.6 also accepts `DISTINCT ON`, and `EXPLAIN` shows it runs as the same `LimitBy` step after sorting:

```sql
SELECT customer, id, created_at
FROM orders
ORDER BY customer, created_at DESC
LIMIT 1 BY customer;
```

```text
Acme Corp   6   2026-11-04 10:00:00
acme        2   2026-11-01 17:40:00
globex      4   2026-11-03 00:00:00
initech     5   2026-11-03 23:59:59
```

`LIMIT 3 BY` gives top-3 per group, which `DISTINCT ON` cannot. The [LIMIT BY guide](/blog/clickhouse-limit-by-typescript) has more.

## COUNT(DISTINCT) and percentile_cont in ClickHouse

`count(DISTINCT x)` is exact by default in ClickHouse: it runs the function named by the `count_distinct_implementation` setting, which defaults to `uniqExact` ([count docs](https://clickhouse.com/docs/sql-reference/aggregate-functions/reference/count)). `uniq(x)` is approximate and uses an adaptive sample of up to 65,536 hashes ([uniq docs](https://clickhouse.com/docs/sql-reference/aggregate-functions/reference/uniq)).

```sql
SELECT
    count(DISTINCT number % 250000) AS count_distinct,
    uniqExact(number % 250000) AS exact,
    uniq(number % 250000) AS approx
FROM numbers(1000000);
```

```text
250000   250000   250699
```

For `percentile_cont`, `quantileExactInclusive(p)(x)` gave the same linearly interpolated answer as the `percentile_cont` formula in our test. `quantileExact` returns an actual value without interpolating, and `quantile` uses reservoir sampling (up to 8,192 values) and is non-deterministic on large inputs ([quantile docs](https://clickhouse.com/docs/sql-reference/aggregate-functions/reference/quantile)):

```sql
SELECT
    quantileExactInclusive(0.9)(x) AS like_percentile_cont,
    quantileExact(0.9)(x) AS quantile_exact,
    quantile(0.9)(x) AS approx
FROM (SELECT arrayJoin([1, 2, 10, 50]) AS x);
```

```text
38.00000000000001   50   38.00000000000001
```

With only four values the reservoir holds every value, so `quantile` matched the exact answer here. More in the [quantile reference](/clickhouse/functions/quantile).

## row_number, lag and lagInFrame in ClickHouse

`row_number()`, `lag(x, offset)` and `lead(x, offset)` work over the partition as in Postgres. `lagInFrame` and `leadInFrame` are ClickHouse extensions that respect the window frame, and the default frame ends at the current row ([window functions docs](https://clickhouse.com/docs/sql-reference/window-functions)). So `leadInFrame` without an explicit frame always returns the default value:

```sql
SELECT
    id,
    amount,
    row_number() OVER (ORDER BY created_at) AS rn,
    lag(amount) OVER (ORDER BY created_at) AS prev_lag,
    leadInFrame(amount) OVER (ORDER BY created_at) AS next_default_frame,
    leadInFrame(amount) OVER (ORDER BY created_at ROWS BETWEEN UNBOUNDED PRECEDING AND UNBOUNDED FOLLOWING) AS next_full_frame
FROM orders
ORDER BY created_at;
```

```text
1   120.5   1   0       0   40
2   40      2   120.5   0   99.99
3   99.99   3   40      0   15
4   15      4   99.99   0   60
5   60      5   15      0   75
6   75      6   60      0   0
```

The first `prev_lag` is `0`, where Postgres returns NULL, because `amount` is a non-Nullable `Float64`. Wrap the column to get NULL: `lag(toNullable(amount)) OVER (ORDER BY created_at)` returns `\N` on the first row. The [window functions guide](/blog/clickhouse-window-functions-typescript) covers running totals and frames.

## How do you upsert in ClickHouse without ON CONFLICT?

ClickHouse has no `INSERT ... ON CONFLICT` or `ON DUPLICATE KEY UPDATE`; in 26.6 both fail with `Cannot parse input`. The usual replacement is a `ReplacingMergeTree` table: insert the new version as a new row, and read with `FINAL` (or `argMax`) to get the latest version per sorting key.

```sql
CREATE TABLE users
(
    id UInt64,
    email String,
    plan String,
    updated_at DateTime
)
ENGINE = ReplacingMergeTree(updated_at)
ORDER BY id;

INSERT INTO users VALUES (1, 'ada@example.com', 'free', '2026-11-01 10:00:00');
INSERT INTO users VALUES (1, 'ada@example.com', 'pro', '2026-11-05 10:00:00');

SELECT count() AS rows_without_final FROM users;
SELECT * FROM users FINAL;
```

```text
2
1   ada@example.com   pro   2026-11-05 10:00:00
```

Deduplication happens only during background merges at an unknown time, and the docs state it "does not guarantee the absence of duplicates" ([ReplacingMergeTree docs](https://clickhouse.com/docs/engines/table-engines/mergetree-family/replacingmergetree)). `PRIMARY KEY` is not a uniqueness constraint either: inserting two rows with the same key into a plain `MergeTree` keeps both. See [FINAL and ReplacingMergeTree](/blog/clickhouse-final-replacingmergetree-typescript).

## UPDATE, DELETE and foreign keys in ClickHouse

ClickHouse has three ways to change rows. `ALTER TABLE ... UPDATE` and `ALTER TABLE ... DELETE` are mutations: asynchronous by default and, per the docs, "a heavy operation not designed for frequent use" ([ALTER UPDATE docs](https://clickhouse.com/docs/sql-reference/statements/alter/update)). Lightweight `DELETE FROM` marks rows as deleted and merges remove them later ([DELETE docs](https://clickhouse.com/docs/sql-reference/statements/delete)). Lightweight `UPDATE ... SET` writes patch parts and requires the `enable_block_number_column` and `enable_block_offset_column` table settings ([UPDATE docs](https://clickhouse.com/docs/sql-reference/statements/update)).

```sql
CREATE TABLE accounts
(
    id UInt64,
    plan String
)
ENGINE = MergeTree
ORDER BY id
SETTINGS enable_block_number_column = 1, enable_block_offset_column = 1;

INSERT INTO accounts VALUES (1, 'free'), (2, 'free'), (3, 'pro');

ALTER TABLE accounts UPDATE plan = 'pro' WHERE id = 1 SETTINGS mutations_sync = 1;
UPDATE accounts SET plan = 'team' WHERE id = 2;
DELETE FROM accounts WHERE id = 3;

SELECT * FROM accounts ORDER BY id;
```

```text
1   pro
2   team
```

Without those settings, `UPDATE` fails with `Lightweight updates are not supported` and suggests `MODIFY SETTING enable_block_number_column = 1`. The UPDATE docs recommend lightweight updates for changing about 10% of a table or less.

ClickHouse has no foreign keys. A table-level `FOREIGN KEY (customer_id) REFERENCES customers(id)` clause is accepted and dropped: `SHOW CREATE TABLE` no longer contains it, and inserting `customer_id = 999` with no matching customer succeeds. An inline `customer_id UInt64 REFERENCES customers(id)` is a syntax error. Enforce relationships in the application or check them with a `LEFT JOIN` ([joins guide](/blog/clickhouse-joins-typescript)).

## JSON operators in ClickHouse

ClickHouse has no `->` or `->>` operators. For JSON stored as `String`, use `JSONExtractString(json, 'key', 'nested_key')` and its typed siblings (`JSONExtractInt`, `JSONExtractFloat`, `JSONExtractRaw`), or `JSON_VALUE(json, '$.path')`. A missing key returns the type default, an empty string for `JSONExtractString`.

```sql
SELECT
    JSONExtractString('{"user": {"plan": "pro"}, "seats": 3}', 'user', 'plan') AS plan,
    JSONExtractInt('{"user": {"plan": "pro"}, "seats": 3}', 'seats') AS seats,
    JSONExtractString('{"seats": 3}', 'plan') AS missing,
    JSON_VALUE('{"user": {"plan": "pro"}}', '$.user.plan') AS json_value;
```

```text
pro   3         pro
```

With the `JSON` column type you use dot paths, and each path comes back as `Dynamic`:

```sql
CREATE TABLE events (id UInt32, props JSON) ENGINE = MergeTree ORDER BY id;

INSERT INTO events VALUES (1, '{"user": {"plan": "pro"}, "seats": 3}'), (2, '{"user": {"plan": "free"}}');

SELECT id, props.user.plan AS plan, toTypeName(plan) AS plan_type, props.seats AS seats
FROM events
WHERE props.user.plan = 'pro';
```

```text
1   pro   Dynamic   3
```

## Why does 7 / 2 return 3.5 in ClickHouse?

In ClickHouse, `/` returns `Float64` for integer and float arguments, so `7 / 2` is `3.5`. Postgres truncates integer division (`5 / 2` is `2`, per the [Postgres docs](https://www.postgresql.org/docs/current/functions-math.html)). For integer division in ClickHouse use `intDiv(a, b)` or the `DIV` operator.

```sql
SELECT
    7 / 2 AS slash,
    toTypeName(7 / 2) AS slash_type,
    intDiv(7, 2) AS int_div,
    7 DIV 2 AS div_operator,
    intDiv(-7, 2) AS negative,
    7 % 2 AS modulo,
    1 / 0 AS by_zero,
    intDivOrZero(7, 0) AS int_div_or_zero;
```

```text
3.5   Float64   3   3   -3   1   inf   0
```

`intDiv(-7, 2)` returned `-3` on 26.6, truncating toward zero like Postgres. Division by zero with `/` returns `inf`, `intDiv(7, 0)` throws `Division by zero`, and `intDivOrZero` returns `0`.

The TypeScript side has the same split. `7 / 2` is `3.5` in JavaScript, `Math.trunc(7 / 2)` is `3` (and `Math.trunc(-7 / 2)` is `-3`, while `Math.floor` gives `-4`), and for 64-bit values `BigInt` division truncates: `7n / 2n` is `3n`.

## Using these from TypeScript with hypequery

In [hypequery](/clickhouse-query-builder), ClickHouse-only expressions go through `rawAs`, which also sets the TypeScript type of the result column. `countIf` returns `UInt64` and `intDiv(sum(amount), count())` returns `Int64` here, so both arrive as strings; `sum(amount) / count()` is `Float64` and arrives as a number. `DISTINCT ON` maps to `.limitBy()`.

```ts
import { createQueryBuilder, rawAs } from '@hypequery/clickhouse';
import type { IntrospectedSchema } from './schema';

const db = createQueryBuilder<IntrospectedSchema>({
  host: process.env.CLICKHOUSE_HOST!,
  username: process.env.CLICKHOUSE_USERNAME!,
  password: process.env.CLICKHOUSE_PASSWORD!,
  database: process.env.CLICKHOUSE_DATABASE!,
});

// GROUP_CONCAT, COUNT ... FILTER and integer division per customer
const perCustomer = await db
  .table('orders')
  .select([
    'customer',
    rawAs<string, 'statuses'>("groupConcat(', ')(status)", 'statuses'),
    rawAs<string, 'paid_orders'>("countIf(status = 'paid')", 'paid_orders'),
    rawAs<string, 'avg_whole'>('intDiv(sum(amount), count())', 'avg_whole'),
    rawAs<number, 'avg_amount'>('sum(amount) / count()', 'avg_amount'),
  ])
  .groupBy('customer')
  .orderBy('customer', 'ASC')
  .execute();

// DISTINCT ON (customer) ... ORDER BY customer, created_at DESC
const latestPerCustomer = await db
  .table('orders')
  .select(['customer', 'id', 'created_at'])
  .orderBy('customer', 'ASC')
  .orderBy('created_at', 'DESC')
  .limitBy(1, 'customer')
  .execute();

// Explode tags, with a date filter that keeps the whole last day
const tagRows = await db
  .table('orders')
  .select(['id', rawAs<string, 'tag'>('arrayJoin(tags)', 'tag')])
  .where((expr) => expr.raw("toDate(created_at) BETWEEN '2026-11-01' AND '2026-11-03'"))
  .execute();
```

Convert `paid_orders` with `Number()` when it fits in 53 bits, or `BigInt()` when it may not. The [quick start](/docs/quick-start) generates the `IntrospectedSchema` type from your tables.

## Related

- [ClickHouse date functions in TypeScript](/blog/clickhouse-date-functions-typescript)
- [ClickHouse ARRAY JOIN in TypeScript](/blog/clickhouse-array-join-typescript)
- [ClickHouse LIMIT BY](/blog/clickhouse-limit-by-typescript)
- [ClickHouse window functions in TypeScript](/blog/clickhouse-window-functions-typescript)
- [FINAL and ReplacingMergeTree](/blog/clickhouse-final-replacingmergetree-typescript)
- [ClickHouse query builder for TypeScript](/clickhouse-query-builder)
- ClickHouse docs: [groupConcat](https://clickhouse.com/docs/sql-reference/aggregate-functions/reference/groupconcat), [dateTrunc](https://clickhouse.com/docs/sql-reference/functions/date-time-functions#date_trunc), [operators](https://clickhouse.com/docs/sql-reference/operators), [window functions](https://clickhouse.com/docs/sql-reference/window-functions), [ReplacingMergeTree](https://clickhouse.com/docs/engines/table-engines/mergetree-family/replacingmergetree), [lightweight UPDATE](https://clickhouse.com/docs/sql-reference/statements/update), [lightweight DELETE](https://clickhouse.com/docs/sql-reference/statements/delete)
