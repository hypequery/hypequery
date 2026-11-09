---
title: "ClickHouse DateTime vs DateTime64: Date Types, Precision and Time Zones"
description: "How ClickHouse's Date, Date32, DateTime and DateTime64 types store values, how column time zones change what you insert and read, and how to parse the results safely in TypeScript."
seoTitle: "ClickHouse DateTime vs DateTime64, Date Types and Time Zones"
seoDescription: "ClickHouse DateTime stores whole seconds; DateTime64(p) stores up to nanoseconds. Both store a UTC instant; the time zone only changes parsing and display."
pubDate: 2026-11-08
updatedAt: 2026-11-08
heroImage: ""
slug: clickhouse-datetime-vs-datetime64-time-zones
status: published
tags:
  - ClickHouse
  - TypeScript
---

ClickHouse has four date and time types: `Date` and `Date32` store a calendar day, `DateTime` stores a Unix timestamp with one-second resolution, and `DateTime64(p)` stores ticks of 10^-p seconds, from `p = 0` up to nanoseconds at `p = 9`. Every `DateTime` and `DateTime64` value is a UTC instant; the time zone in `DateTime('UTC')` is column metadata that decides how strings are parsed on the way in and how values are printed on the way out. Over JSON all four types come back as strings without a time zone offset, so a TypeScript client has to know which zone the string was rendered in before it turns it into a `Date`.

Everything below was run on ClickHouse 26.6. For the bucketing functions (`toStartOfDay`, `toStartOfWeek`, `toStartOfInterval`) see [ClickHouse date functions in TypeScript](/blog/clickhouse-date-functions-typescript); this post is about the types underneath them.

## What are the ClickHouse date types?

ClickHouse's date types differ in resolution, range and size: `Date` and `Date32` hold days, `DateTime` holds seconds, and `DateTime64(p)` holds fractions of a second.

| Type | Bytes | Range on 26.6 | Resolution | Time zone |
|---|---|---|---|---|
| `Date` | 2 | 1970-01-01 to 2149-06-06 | 1 day | none |
| `Date32` | 4 | 1900-01-01 to 2299-12-31 | 1 day | none |
| `DateTime` | 4 | 1970-01-01 00:00:00 to 2106-02-07 06:28:15 UTC | 1 second | optional |
| `DateTime64(3)` | 8 | 1900-01-01 to 2299-12-31 | 1 millisecond | optional |
| `DateTime64(9)` | 8 | up to 2262-04-11 23:47:16 UTC | 1 nanosecond | optional |

```sql
SELECT
    byteSize(toDate('2026-03-01')) AS date_bytes,
    byteSize(toDate32('2026-03-01')) AS date32_bytes,
    byteSize(toDateTime('2026-03-01 12:00:00')) AS datetime_bytes,
    byteSize(toDateTime64('2026-03-01 12:00:00', 9)) AS datetime64_bytes;
```

```text
2	4	4	8
```

Values outside the range are clamped without an error. Inserting `'2200-01-01'` into a `Date` column stores `2149-06-06`, and `'2200-01-01 00:00:00'` into a `DateTime('UTC')` column stores `2106-02-07 06:28:15`:

```sql
CREATE TABLE range_demo (d Date, dt DateTime('UTC')) ENGINE = MergeTree ORDER BY d;
INSERT INTO range_demo VALUES ('2200-01-01', '2200-01-01 00:00:00');
SELECT * FROM range_demo;
```

```text
2149-06-06	2106-02-07 06:28:15
```

`DateTime64(9)` is the exception: going past 2262-04-11 23:47:16 fails with `Decimal math overflow (DECIMAL_OVERFLOW)`. The current [DateTime64 docs](https://clickhouse.com/docs/sql-reference/data-types/datetime64) describe a wider range than the one above, so if you rely on dates before 1900 or after 2299, check them on your own server version.

## Is ClickHouse DateTime precision seconds only?

Yes, `DateTime` has a resolution of one second, and any fractional part is truncated rather than rounded. Use `DateTime64(3)` for milliseconds, `DateTime64(6)` for microseconds or `DateTime64(9)` for nanoseconds; precision accepts 0 to 9, and 10 fails with `Scale 10 is too large for DateTime64`.

```sql
SET session_timezone = 'UTC';
CREATE TABLE precision_demo (dt DateTime, dt3 DateTime64(3), dt6 DateTime64(6))
ENGINE = MergeTree ORDER BY dt;
INSERT INTO precision_demo VALUES
    ('2026-03-01 12:00:00.999999', '2026-03-01 12:00:00.999999', '2026-03-01 12:00:00.999999');
SELECT * FROM precision_demo;
```

```text
2026-03-01 12:00:00	2026-03-01 12:00:00.999	2026-03-01 12:00:00.999999
```

`.999999` became `12:00:00` and `.999`, never `12:00:01`. The same happens with `toDateTime(now64())` or when a `DateTime64` value passes through a function that returns `DateTime`, such as `toStartOfDay`.

## How do time zones work in a ClickHouse DateTime column?

A `DateTime` column always stores seconds since the Unix epoch in UTC. The [DateTime docs](https://clickhouse.com/docs/sql-reference/data-types/datetime) say the time zone "is not stored in the rows of the table (or in resultset), but is stored in the column metadata". The zone matters at three points: when a string is parsed into the column, when the value is printed, and when calendar functions like `toDate` or `toStartOfDay` decide which day a timestamp falls on.

Insert the same string into three columns and you get three different instants:

```sql
CREATE TABLE tz_demo (
    ts_utc DateTime('UTC'),
    ts_ny DateTime('America/New_York'),
    ts_default DateTime
) ENGINE = MergeTree ORDER BY ts_utc;
INSERT INTO tz_demo SETTINGS session_timezone = 'Europe/Madrid'
VALUES ('2026-03-01 12:00:00', '2026-03-01 12:00:00', '2026-03-01 12:00:00');
SELECT toUnixTimestamp(ts_utc), toUnixTimestamp(ts_ny), toUnixTimestamp(ts_default) FROM tz_demo;
```

```text
1772366400	1772384400	1772362800
```

The string was read as noon UTC, noon New York (UTC-5) and noon Madrid (UTC+1). A column declared as plain `DateTime` uses the session time zone, which is the server's `timezone` setting unless the query or session sets `session_timezone`. That means the same stored row prints differently depending on who reads it:

```sql
CREATE TABLE events_plain (id UInt32, created_at DateTime) ENGINE = MergeTree ORDER BY id;
INSERT INTO events_plain SETTINGS session_timezone = 'UTC' VALUES (1, '2026-03-01 12:00:00');
SELECT created_at, toUnixTimestamp(created_at) FROM events_plain SETTINGS session_timezone = 'UTC';
SELECT created_at, toUnixTimestamp(created_at) FROM events_plain SETTINGS session_timezone = 'Asia/Tokyo';
```

```text
2026-03-01 12:00:00	1772366400
2026-03-01 21:00:00	1772366400
```

`SELECT timezone(), serverTimezone()` shows both zones for the current session. If you declare event columns as `DateTime('UTC')` or `DateTime64(3, 'UTC')`, no server or session setting can shift them.

`toTimeZone` changes only the display zone. The instant and equality are unchanged:

```sql
SELECT
    toDateTime('2026-03-01 12:00:00', 'UTC') AS utc,
    toTimeZone(utc, 'America/New_York') AS ny,
    toTypeName(ny) AS ny_type,
    utc = ny AS same_instant
FORMAT Vertical;
```

```text
utc:          2026-03-01 12:00:00
ny:           2026-03-01 07:00:00
ny_type:      DateTime('America/New_York')
same_instant: 1
```

## How do you convert to DateTime in ClickHouse?

Use `toDateTime(value, [tz])` for strings, Unix seconds and `Date` values, `toDateTime64(value, precision, [tz])` when you need fractions, and `parseDateTimeBestEffort` for formats other than `YYYY-MM-DD HH:MM:SS`.

```sql
SET session_timezone = 'UTC';
SELECT
    toDateTime('2026-03-01 12:00:00', 'America/New_York') AS from_string,
    toDateTime(1772366400) AS from_seconds,
    toDateTime(toDate('2026-03-01')) AS from_date,
    toDateTime64('2026-03-01 12:00:00.123', 3, 'UTC') AS with_millis,
    toDateTimeOrNull('not a date') AS bad_input
FORMAT Vertical;
```

```text
from_string:  2026-03-01 12:00:00
from_seconds: 2026-03-01 12:00:00
from_date:    2026-03-01 00:00:00
with_millis:  2026-03-01 12:00:00.123
bad_input:    ᴺᵁᴸᴸ
```

A string without an offset is read in the zone you pass, or the session zone if you pass none. ISO 8601 strings with `Z` or `+02:00` keep their offset:

```sql
SET session_timezone = 'UTC';
SELECT
    parseDateTimeBestEffort('2026-03-01T12:00:00Z') AS iso_z,
    parseDateTimeBestEffort('2026-03-01T12:00:00+02:00') AS iso_offset,
    parseDateTime64BestEffort('2026-03-01T12:00:00.123Z', 3) AS iso_millis,
    parseDateTimeBestEffortUS('03/01/2026 12:00') AS us_format,
    parseDateTimeBestEffort('03/01/2026 12:00') AS day_first
FORMAT Vertical;
```

```text
iso_z:      2026-03-01 12:00:00
iso_offset: 2026-03-01 10:00:00
iso_millis: 2026-03-01 12:00:00.123
us_format:  2026-03-01 12:00:00
day_first:  2026-01-03 12:00:00
```

The last line is the one to watch: without the `US` suffix, `03/01/2026` is read as 3 January. Invalid input throws `CANNOT_PARSE_DATETIME`; use `parseDateTimeBestEffortOrNull` when the data is untrusted.

## How do fromUnixTimestamp64Milli and fromUnixTimestamp64Nano work?

`fromUnixTimestamp64Milli`, `fromUnixTimestamp64Micro` and `fromUnixTimestamp64Nano` turn an integer epoch value into `DateTime64(3)`, `DateTime64(6)` or `DateTime64(9)`, with an optional time zone. `toUnixTimestamp64Milli` and friends go the other way and return `Int64`.

```sql
SET session_timezone = 'UTC';
SELECT
    fromUnixTimestamp64Milli(1772366400123) AS ms,
    toTypeName(ms) AS ms_type,
    fromUnixTimestamp64Nano(1772366400123456789) AS ns,
    toTypeName(ns) AS ns_type,
    fromUnixTimestamp64Milli(1772366400123, 'Asia/Tokyo') AS ms_tokyo,
    toUnixTimestamp64Milli(ms) AS back_to_ms
FORMAT Vertical;
```

```text
ms:         2026-03-01 12:00:00.123
ms_type:    DateTime64(3)
ns:         2026-03-01 12:00:00.123456789
ns_type:    DateTime64(9)
ms_tokyo:   2026-03-01 21:00:00.123
back_to_ms: 1772366400123
```

Do not pass a JavaScript millisecond timestamp to `toDateTime`. `toDateTime(1772366400123, 'UTC')` returns `2106-02-07 06:28:15`, the clamped maximum, with no error.

## How do you convert a ClickHouse DateTime to a Date or a string?

`toDate(ts)` returns the calendar day in the column's time zone, `toDate(ts, 'Zone')` returns it in another zone, and `toString(ts, ['Zone'])` returns the text form as a `String`. For custom formats use [formatDateTime](/clickhouse/functions/format-date-time).

```sql
SET session_timezone = 'UTC';
SELECT
    toDateTime('2026-03-01 23:30:00', 'UTC') AS ts,
    toDate(ts) AS d_utc,
    toDate(ts, 'Asia/Tokyo') AS d_tokyo,
    toString(ts) AS s_utc,
    toString(ts, 'Asia/Tokyo') AS s_tokyo,
    formatDateTime(ts, '%Y-%m-%dT%H:%i:%SZ') AS iso
FORMAT Vertical;
```

```text
ts:      2026-03-01 23:30:00
d_utc:   2026-03-01
d_tokyo: 2026-03-02
s_utc:   2026-03-01 23:30:00
s_tokyo: 2026-03-02 08:30:00
iso:     2026-03-01T23:30:00Z
```

The same timestamp falls on 1 March in UTC and 2 March in Tokyo. If your dashboard shows "events per day" for users in one region, pass that region's zone to `toDate`. More on the function itself is on the [toDate reference page](/clickhouse/functions/to-date).

## What do now(), now64(), today() and yesterday() return?

`now()` returns `DateTime`, `now64(p)` returns `DateTime64(p)` with a default precision of 3, and `today()` and `yesterday()` return `Date`. All of them use the session time zone unless you pass one (`now64(9, 'Asia/Tokyo')` has type `DateTime64(9, 'Asia/Tokyo')`), so `today()` depends on where the session thinks it is:

```sql
SELECT today() SETTINGS session_timezone = 'UTC';
SELECT today() SETTINGS session_timezone = 'Pacific/Kiritimati';
```

Run at 15:31 UTC on 8 November 2026, the first query returned `2026-11-08` and the second `2026-11-09`. `today() - yesterday()` is `1`, an `Int32` count of days.

## How does INTERVAL arithmetic work on ClickHouse dates?

`INTERVAL n UNIT` has its own type (`INTERVAL 7 DAY` is `IntervalDay`) and adding it to a date or time returns a date or time. Month arithmetic clamps to the end of the month, and adding a sub-second interval to a `DateTime` promotes it to `DateTime64`.

```sql
SET session_timezone = 'UTC';
SELECT
    toDate('2026-01-31') + INTERVAL 1 MONTH AS end_of_month,
    toDate('2026-03-01') - INTERVAL 1 HOUR AS date_minus_hour,
    toTypeName(date_minus_hour) AS dmh_type,
    toDateTime('2026-03-01 12:00:00') + INTERVAL 500 MILLISECOND AS plus_ms,
    toTypeName(plus_ms) AS plus_ms_type,
    toDateTime('2026-03-01 12:00:00') + INTERVAL '1 day 2 hours' AS compound
FORMAT Vertical;
```

```text
end_of_month:    2026-02-28
date_minus_hour: 2026-02-28 23:00:00
dmh_type:        DateTime
plus_ms:         2026-03-01 12:00:00.500
plus_ms_type:    DateTime64(3)
compound:        2026-03-02 14:00:00
```

## What happens when you compare DateTime with DateTime64 or a string?

Comparing `DateTime` with `DateTime64` converts both to `DateTime64` and compares the full value, so `12:00:00` is less than `12:00:00.750`. Comparing either type with a string literal parses the string in the column's time zone, using the column's precision.

```sql
SET session_timezone = 'UTC';
SELECT
    toDateTime('2026-03-01 12:00:00') AS dt,
    toDateTime64('2026-03-01 12:00:00.750', 3) AS dt64,
    dt = dt64 AS eq,
    dt < dt64 AS lt,
    toTypeName([dt, dt64]) AS common_type,
    dt = '2026-03-01 12:00:00.750' AS dt_vs_string
FORMAT Vertical;
```

```text
dt:           2026-03-01 12:00:00
dt64:         2026-03-01 12:00:00.750
eq:           0
lt:           1
common_type:  Array(DateTime64(3))
dt_vs_string: 1
```

`dt_vs_string` is `1` because the literal was parsed as a `DateTime` and lost its `.750`. The time zone rule is easy to miss: on a `DateTime('America/New_York')` column, `ts = '2026-03-01 12:00:00'` means noon in New York. The [session_timezone docs](https://clickhouse.com/docs/operations/settings/settings#session_timezone) note that a string compared with a column "inherits the type and time zone of the existing column", while `toDateTime('...')` without a zone uses the session zone.

There is one more trap on 26.6. When the column is part of the table's sorting key, ClickHouse converts the literal for index analysis using only the basic `YYYY-MM-DD HH:MM:SS` format. ISO strings fail, and so do fractional seconds on a `DateTime` key:

```sql
CREATE TABLE keyed (ts DateTime('UTC')) ENGINE = MergeTree ORDER BY ts;
INSERT INTO keyed VALUES ('2026-03-01 12:00:00');
SELECT count() FROM keyed WHERE ts >= '2026-03-01 12:00:00';
SELECT count() FROM keyed WHERE ts >= parseDateTime64BestEffort('2026-03-01T12:00:00.000Z', 3);
```

Both return `1`. `WHERE ts >= '2026-03-01T12:00:00Z'` on the same table fails with `Cannot convert string '2026-03-01T12:00:00Z' to type DateTime('UTC'). (TYPE_MISMATCH)`, and the same query works on a column that isn't in `ORDER BY`. Wrapping the value in `parseDateTime64BestEffort` works on `DateTime` and `DateTime64` keys in any time zone, because the `Z` fixes the instant.

## Why do times shift when you insert strings?

A string inserted into a `DateTime` or `DateTime64` column without an offset is read in that column's time zone, so `'2026-03-01 12:00:00'` from a UTC service lands five hours late in a `DateTime('America/New_York')` column. Strings with `Z` or an offset keep their instant when the parser accepts them, and that depends on `date_time_input_format`.

On 26.6 the default is `best_effort`, which reads ISO 8601 such as `2026-03-01T12:00:00.000Z`. `system.settings_changes` records that the default changed from `basic` to `best_effort` in 26.5; under `basic`, ClickHouse "can parse only the basic `YYYY-MM-DD HH:MM:SS` or `YYYY-MM-DD` format", and a JSON row with `"2026-03-01T12:00:00.000Z"` fails with `CANNOT_PARSE_INPUT_ASSERTION_FAILED`. Run `SELECT getSetting('date_time_input_format')` on your server before relying on either behaviour.

`Date` columns are stricter still. A JSONEachRow value of `"2026-03-01T12:00:00.789Z"` for a `Date` column fails to parse even with `best_effort`; send `"2026-03-01"`.

## How does DST affect toStartOfDay in ClickHouse?

`toStartOfDay(ts, 'Zone')` returns local midnight in that zone as a `DateTime`, and on a daylight saving change the local day is 23 or 25 hours long, so adding 86,400 seconds to midnight does not land on the next midnight. `INTERVAL 1 DAY` does.

```sql
SET session_timezone = 'UTC';
SELECT
    toStartOfDay(toDateTime('2026-03-08 12:00:00', 'America/New_York')) AS day_start,
    day_start + INTERVAL 1 DAY AS next_day,
    day_start + 86400 AS plus_86400,
    dateDiff('second', day_start, next_day) AS seconds_in_day;
```

```text
2026-03-08 00:00:00	2026-03-09 00:00:00	2026-03-09 01:00:00	82800
```

The day boundary in UTC also moves. Here the New York day starts at 05:00 UTC before the change and 04:00 UTC after it:

```sql
CREATE TABLE events (id UInt64, created_at DateTime64(3, 'UTC')) ENGINE = MergeTree ORDER BY created_at;
INSERT INTO events VALUES
    (1, '2026-03-08 03:30:00.120'), (2, '2026-03-08 04:59:59.999'),
    (3, '2026-03-08 05:00:00.000'), (4, '2026-03-09 03:59:59.500');
SELECT toDate(created_at, 'America/New_York') AS ny_date, count() AS events
FROM events GROUP BY ny_date ORDER BY ny_date;
```

```text
2026-03-07	2
2026-03-08	2
```

Rows 3 and 4 are 23 hours apart and still fall on the same New York day. Local times that don't exist or happen twice are resolved by rule: `toDateTime('2026-03-08 02:30:00', 'America/New_York')` returns `01:30:00`, and for repeated times the docs say "ClickHouse always picks the earlier occurrence".

## How do ClickHouse dates come back over JSON?

In JSON output formats every date type is a string. `Date` is `YYYY-MM-DD`, `DateTime` is `YYYY-MM-DD HH:MM:SS` in the column's or session's zone with no offset, and `DateTime64(p)` adds exactly `p` fractional digits.

```sql
SET session_timezone = 'UTC';
SELECT
    toDate('2026-03-01') AS d,
    toDateTime('2026-03-01 12:00:00', 'UTC') AS dt_utc,
    toTimeZone(dt_utc, 'America/New_York') AS dt_ny,
    toDateTime64('2026-03-01 12:00:00.123', 3, 'UTC') AS dt64_3,
    toDateTime64('2026-03-01 12:00:00.123456789', 9, 'UTC') AS dt64_9
FORMAT JSONEachRow;
```

```text
{"d":"2026-03-01","dt_utc":"2026-03-01 12:00:00","dt_ny":"2026-03-01 07:00:00","dt64_3":"2026-03-01 12:00:00.123","dt64_9":"2026-03-01 12:00:00.123456789"}
```

`dt_utc` and `dt_ny` are the same instant, and nothing in the JSON says so. The `date_time_output_format` setting changes this. With `iso`, ClickHouse prints UTC with a `Z` (`"2026-03-01T17:00:00.123Z"` for a New York `DateTime64(3)` value at noon local time), which JavaScript's `Date` parses correctly. With `unix_timestamp` you get quoted epoch strings like `"1772366400.123"`. `Date` values stay `"2026-03-01"` in both modes.

## How do you parse ClickHouse dates in TypeScript?

hypequery types `Date`, `Date32`, `DateTime` and `DateTime64` columns as `string`, because that is what arrives over JSON. The risk is `new Date('2026-03-01 12:00:00')`: in Node 22 that string is read in the process's local time zone, so it gives `12:00Z` with `TZ=UTC`, `20:00Z` in Los Angeles and `03:00Z` in Tokyo.

The fix is to make sure ClickHouse renders UTC, then parse with an explicit `Z`. Store timestamps as `DateTime64(3, 'UTC')`, or set the session zone on the connection so plain `DateTime` columns render in UTC too:

```ts
import { createQueryBuilder, rawAs } from '@hypequery/clickhouse';
import type { IntrospectedSchema } from './schema';

const db = createQueryBuilder<IntrospectedSchema>({
  host: process.env.CLICKHOUSE_HOST!,
  username: process.env.CLICKHOUSE_USERNAME!,
  password: process.env.CLICKHOUSE_PASSWORD!,
  database: process.env.CLICKHOUSE_DATABASE!,
  clickhouse_settings: { session_timezone: 'UTC' },
});

// '2026-03-01 12:00:00.123' -> Date at 12:00:00.123 UTC
export function fromClickHouseUtc(value: string): Date {
  return new Date(value.length === 10 ? `${value}T00:00:00Z` : `${value.replace(' ', 'T')}Z`);
}

// Date -> '2026-03-01 12:00:00' (DateTime) or '2026-03-01 12:00:00.123' (DateTime64(3))
export function toClickHouseUtc(d: Date, millis = false): string {
  return d.toISOString().replace('T', ' ').slice(0, millis ? 23 : 19);
}

const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

const rows = await db
  .table('events')
  .select([rawAs<string, 'ny_date'>("toDate(created_at, 'America/New_York')", 'ny_date')])
  .count('id', 'events')
  .where('created_at', 'gte', toClickHouseUtc(since, true))
  .groupBy('ny_date')
  .orderBy('ny_date', 'ASC')
  .execute();
// rows: { ny_date: string; events: string }[]
```

A few rules keep this correct:

- Return day buckets as `toDate(created_at, 'Zone')`. A `Date` string has no time of day, so there is nothing to misread. `toStartOfDay(created_at, 'America/New_York')` returns local midnight as a `DateTime` string, and `fromClickHouseUtc` would read it as UTC midnight, five hours off.
- `events` is a string because `count()` returns `UInt64`, which hypequery asks ClickHouse to quote.
- The filter string is read in the column's zone, so `toClickHouseUtc` is only right for UTC columns. For a column in another zone, use `.where((expr) => expr.raw("created_at >= parseDateTime64BestEffort('2026-03-01T00:00:00Z', 3)"))`.
- JavaScript `Date` holds milliseconds. `fromClickHouseUtc('2026-03-01 12:00:00.123456789')` returns `.123`. If you need all nine digits, select `toUnixTimestamp64Nano(created_at)`, which arrives as a string (it is `Int64`), and use `BigInt`.
- If you'd rather not write a parser, `clickhouse_settings: { date_time_output_format: 'iso' }` makes every `DateTime` and `DateTime64` string end in `Z`, and `new Date(value)` is then safe.

For a fuller tour of the builder see [hypequery for ClickHouse in TypeScript](/clickhouse-typescript), and for building time-bucketed charts see [ClickHouse time-series queries](/clickhouse-time-series).

## Related

- [ClickHouse date functions in TypeScript](/blog/clickhouse-date-functions-typescript)
- [toDate function reference](/clickhouse/functions/to-date)
- [formatDateTime function reference](/clickhouse/functions/format-date-time)
- [toStartOfInterval function reference](/clickhouse/functions/to-start-of-interval)
- [ClickHouse schema types in TypeScript](/clickhouse-schema)
- [ClickHouse time series](/clickhouse-time-series)
- ClickHouse docs: [DateTime](https://clickhouse.com/docs/sql-reference/data-types/datetime), [DateTime64](https://clickhouse.com/docs/sql-reference/data-types/datetime64), [Date](https://clickhouse.com/docs/sql-reference/data-types/date), [session_timezone](https://clickhouse.com/docs/operations/settings/settings#session_timezone)
