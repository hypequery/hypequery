---
title: "ClickHouse Settings for Application Backends: Readonly Users, 64-bit Integers and Query Limits"
description: "The ClickHouse settings a Node.js or Python API should configure: readonly = 1 vs 2, output_format_json_quote_64bit_integers, cancel_http_readonly_queries_on_client_close, and limits like max_execution_time. Every example was run on ClickHouse 26.6."
seoTitle: "ClickHouse Readonly User and API Settings (readonly 1 vs 2)"
seoDescription: "readonly = 1 blocks writes and setting changes; readonly = 2 blocks writes but allows SET. Plus 64-bit integer quoting, query limits and HTTP cancellation."
pubDate: 2026-11-08
updatedAt: 2026-11-08
heroImage: ""
slug: clickhouse-settings-for-application-backends
status: published
tags:
  - ClickHouse
  - API
---

An application backend should query ClickHouse as a dedicated user with `readonly = 2`, query limits such as `max_execution_time` and `max_result_rows` in that user's settings profile, `cancel_http_readonly_queries_on_client_close = 1`, and `output_format_json_quote_64bit_integers = 1` if the client is JavaScript. `readonly = 1` and `readonly = 2` both block writes and DDL; the difference is that `readonly = 1` also rejects any setting change that differs from the profile, including the integer quoting that JavaScript clients send. Since ClickHouse 25.8 the default for `output_format_json_quote_64bit_integers` is `0`, so `Int64` values such as `count()` arrive as bare JSON numbers and lose precision above 2^53 in JavaScript.

All SQL below was run on ClickHouse 26.6 with `clickhouse local`, and the HTTP examples against `play.clickhouse.com`.

## Which ClickHouse settings matter for an API backend?

Six settings cover most of what an API in front of ClickHouse needs: one for permissions, one for JSON encoding, one for cancellation and three limits. Here are their defaults on 26.6, from `system.settings`:

```sql
SELECT name, value
FROM system.settings
WHERE name IN ('readonly', 'output_format_json_quote_64bit_integers',
  'cancel_http_readonly_queries_on_client_close', 'max_execution_time',
  'max_result_rows', 'max_bytes_to_read')
ORDER BY name;
```

```text
cancel_http_readonly_queries_on_client_close	0
max_bytes_to_read	0
max_execution_time	0
max_result_rows	0
output_format_json_quote_64bit_integers	0
readonly	0
```

| Setting | Default on 26.6 | Suggested for an API user |
| --- | --- | --- |
| `readonly` | `0` (no restrictions) | `2` |
| `output_format_json_quote_64bit_integers` | `0` (unquoted) | `1` for JavaScript clients |
| `cancel_http_readonly_queries_on_client_close` | `0` | `1` |
| `max_execution_time` | `0` (unlimited) | Your API timeout, in seconds |
| `max_result_rows` | `0` (unlimited) | The most rows one response should return |
| `max_bytes_to_read` | `0` (unlimited) | A ceiling on uncompressed bytes scanned |

A `0` on the limits means no limit. The `system.settings` description for `cancel_http_readonly_queries_on_client_close` notes a Cloud default of `1`, so ClickHouse Cloud and self-hosted servers differ here.

## How do I create a ClickHouse readonly user?

Create a settings profile with `readonly = 2` and your limits, create the user with that profile, and grant `SELECT` on the databases the API reads:

```sql
CREATE DATABASE analytics;
CREATE SETTINGS PROFILE api_profile SETTINGS
  readonly = 2,
  max_execution_time = 10 MAX 30,
  max_result_rows = 100000,
  max_bytes_to_read = 10000000000,
  cancel_http_readonly_queries_on_client_close = 1,
  output_format_json_quote_64bit_integers = 1;
CREATE USER api_reader IDENTIFIED WITH sha256_password BY 'change-me'
  SETTINGS PROFILE 'api_profile';
GRANT SELECT ON analytics.* TO api_reader;
SHOW GRANTS FOR api_reader;
```

```text
GRANT SELECT ON analytics.* TO api_reader
```

`readonly` stops writes. Grants decide which tables the user can read. You need both: a readonly user with `SELECT ON *.*` can still read every table on the server.

## What is the difference between readonly = 1 and readonly = 2?

`readonly = 1` allows read queries only, and rejects any attempt to change a setting to a value other than the one already in effect. `readonly = 2` allows read queries plus `SET`, `CREATE TEMPORARY TABLE` and `RESTORE`, and lets the client change any setting except `readonly` itself. The [permissions docs](https://clickhouse.com/docs/operations/settings/permissions-for-queries) list what each level allows; the `system.settings` description reads "1 - only read requests, as well as changing explicitly allowed settings. 2 - only read requests, as well as changing settings, except for the 'readonly' setting."

Here is each level tested with `SET readonly = ...` in `clickhouse local`:

```sql
SET readonly = 1;
SELECT 1 SETTINGS max_execution_time = 5;
```

```text
Code: 164. DB::Exception: Code: 164. DB::Exception: Cannot modify 'max_execution_time' setting in readonly mode. (READONLY) (version 26.6.2.20 (official build)). (READONLY)
```

```sql
SET readonly = 2;
SET max_execution_time = 5;
SELECT getSetting('max_execution_time');
```

```text
5
```

| Statement | `readonly = 1` | `readonly = 2` |
| --- | --- | --- |
| `SELECT` | Allowed | Allowed |
| `INSERT INTO t VALUES (1)` | Code 164, `Cannot execute query in readonly mode` | Code 164 |
| `CREATE TABLE ... ENGINE = Memory` | Code 164 | Code 164 |
| `CREATE TEMPORARY TABLE` | Code 164 | Allowed |
| `SET max_execution_time = 5` | Code 164, `Cannot modify 'max_execution_time'` | Allowed |
| `SELECT ... SETTINGS max_execution_time = 5` | Code 164 | Allowed |
| Setting a value equal to the current one | Allowed | Allowed |
| `SET readonly = 0` or `SET readonly = 1` | Code 164, `Cannot modify 'readonly'` | Code 164 |

The "equal to the current one" row is why some clients work against a `readonly = 1` user and others don't. `play.clickhouse.com`'s `play` user has `readonly = 1` and `max_execution_time = 60`. Passing `max_execution_time=60` on the URL succeeds; passing a different value fails:

```bash
curl 'https://play.clickhouse.com/?user=play&max_execution_time=60' \
  --data-binary 'SELECT 1 AS x FORMAT JSONEachRow'
# {"x":1}

curl 'https://play.clickhouse.com/?user=play' \
  --data-binary 'SET max_execution_time = 5'
# Code: 164. DB::Exception: Cannot modify 'max_execution_time' setting in readonly mode. (READONLY)
```

If you need `readonly = 1` but want one setting to stay adjustable, mark it `CHANGEABLE_IN_READONLY` in the profile. The [constraints docs](https://clickhouse.com/docs/operations/settings/constraints-on-settings) say this lets users change the setting within its `MIN`/`MAX` range even when `readonly = 1`:

```sql
CREATE SETTINGS PROFILE p1 SETTINGS readonly = 1, max_execution_time = 10 CHANGEABLE_IN_READONLY;
SET profile = 'p1';
SET max_execution_time = 5;
SELECT getSetting('max_execution_time');
```

```text
5
```

For most APIs `readonly = 2` with constraints is simpler: the client can tighten limits per query, and `MAX` stops it raising them past what you allow.

## Why does ClickHouse return 64-bit integers as strings in JSON?

ClickHouse quotes `Int64`, `UInt64` and wider integers in JSON output when `output_format_json_quote_64bit_integers = 1`, because JavaScript parses JSON numbers as doubles and cannot represent integers above 2^53 (9007199254740992) exactly. On 26.6 the default is `0`, so they come back unquoted:

```sql
SELECT toInt64(9007199254740993) AS n FORMAT JSONEachRow;
SELECT toInt64(9007199254740993) AS n SETTINGS output_format_json_quote_64bit_integers = 1 FORMAT JSONEachRow;
```

```text
{"n":9007199254740993}
{"n":"9007199254740993"}
```

Parse both in Node.js and the unquoted one changes value without any error:

```js
JSON.parse('{"n":9007199254740993}').n;   // 9007199254740992
JSON.parse('{"n":"9007199254740993"}').n; // '9007199254740993'
BigInt('9007199254740993');               // 9007199254740993n
Number.MAX_SAFE_INTEGER;                  // 9007199254740991
```

The default changed in 25.8. `system.settings_changes` on 26.6 records it as `output_format_json_quote_64bit_integers` going from `1` to `0` with the note "Disable quoting of the 64 bit integers in JSON by default". The setting's own description in `system.settings` still says "Such integers are enclosed in quotes by default", so trust the `value` column rather than the text. If your API returned strings for `count()` on an older server and numbers after an upgrade, this is why.

The setting covers every integer type of 64 bits or more. `count()` returns `UInt64` and integer `sum()` returns `Int64` or `UInt64`, so both are affected:

```sql
SELECT toInt128(9007199254740993) AS a, toUInt256(9007199254740993) AS b, toUInt32(5) AS c
SETTINGS output_format_json_quote_64bit_integers = 1 FORMAT JSONEachRow;
```

```text
{"a":"9007199254740993","b":"9007199254740993","c":5}
```

Python's `json` module parses big integers exactly (`json.loads('{"n":9007199254740993}')["n"]` returns `9007199254740993`), so the quoting matters mostly for JavaScript and TypeScript clients.

## Should I quote decimals and floats in ClickHouse JSON output?

Quote decimals if they can exceed about 15 significant digits. `output_format_json_quote_decimals` is `0` by default on 26.6, and a large `Decimal128` then arrives as a JSON number that both JavaScript and Python's default `json.loads` round:

```sql
SELECT toDecimal128('12345678901234567890.12', 2) AS d FORMAT JSONEachRow;
SELECT toDecimal128('12345678901234567890.12', 2) AS d SETTINGS output_format_json_quote_decimals = 1 FORMAT JSONEachRow;
```

```text
{"d":12345678901234567890.12}
{"d":"12345678901234567890.12"}
```

In Node.js, `JSON.parse` turns the first into `12345678901234567000`. In Python, `json.loads` gives `1.2345678901234567e+19` unless you pass `parse_float=decimal.Decimal`. For money columns with a few digits, such as `toDecimal64(12.34, 2)`, the unquoted `12.34` is fine.

`output_format_json_quote_64bit_floats` also exists (default `0`) and quotes `Float64` values. Floats are already doubles, so most APIs leave it off. Note that `NaN` and `inf` come back as `null` unless `output_format_json_quote_denormals = 1`:

```sql
SELECT toFloat64(0.1) AS f, 1/0 AS inf, toFloat64(nan) AS n FORMAT JSONEachRow;
```

```text
{"f":0.1,"inf":null,"n":null}
```

## Why does my readonly user reject output_format_json_quote_64bit_integers?

A `readonly = 1` user rejects `output_format_json_quote_64bit_integers = 1` because it is a setting change, and `readonly = 1` refuses setting changes whose value differs from the profile. JavaScript clients that send it per query hit this error:

```bash
curl 'https://play.clickhouse.com/?user=play&output_format_json_quote_64bit_integers=1' \
  --data-binary 'SELECT toInt64(9007199254740993) AS n FORMAT JSONEachRow'
# Code: 164. DB::Exception: Cannot modify 'output_format_json_quote_64bit_integers' setting in readonly mode. (READONLY)
```

You have four ways out:

1. Switch the user to `readonly = 2`. The client can then send the setting.
2. Keep `readonly = 1` and put `output_format_json_quote_64bit_integers = 1` in the user's profile. A request that sends the same value is accepted; a request that sends `0` is then rejected.
3. Mark the setting `CHANGEABLE_IN_READONLY` in the profile.
4. Stop sending the setting and accept unquoted integers, with the precision loss above 2^53.

Option 2, checked in `clickhouse local`:

```sql
CREATE SETTINGS PROFILE p1 SETTINGS readonly = 1, output_format_json_quote_64bit_integers = 1;
SET profile = 'p1';
SELECT toInt64(9007199254740993) AS n SETTINGS output_format_json_quote_64bit_integers = 1 FORMAT JSONEachRow;
```

```text
{"n":"9007199254740993"}
```

## What does cancel_http_readonly_queries_on_client_close do?

`cancel_http_readonly_queries_on_client_close = 1` makes ClickHouse cancel a read-only HTTP query, such as a `SELECT`, when the client closes the connection without waiting for the response. That is the `system.settings` description on 26.6. Without it, the [HTTP interface docs](https://clickhouse.com/docs/interfaces/http) say "Running requests don't stop automatically if the HTTP connection is lost."

For an API this matters when a user closes the browser tab, your server times out a request, or a load balancer drops the connection. With the default of `0` on self-hosted ClickHouse, the query keeps running and using CPU and memory until it finishes or hits `max_execution_time`. ClickHouse Cloud's default is `1`.

Set it in the profile rather than per query. A `readonly = 1` user can't set it per query unless the profile already has the same value.

## Which ClickHouse settings stop expensive API queries?

`max_execution_time`, `max_result_rows` and `max_bytes_to_read` cap a query's run time, result size and scan size. Each throws an error when exceeded:

```sql
SELECT count() FROM numbers_mt(1e12)
SETTINGS max_execution_time = 1, timeout_before_checking_execution_speed = 0;
```

```text
Code: 159. DB::Exception: Timeout exceeded: elapsed 1000.217 ms, maximum: 1000 ms. (TIMEOUT_EXCEEDED)
```

```sql
SELECT number FROM numbers(1000000) SETTINGS max_result_rows = 1000 FORMAT Null;
```

```text
Code: 396. DB::Exception: Limit for result exceeded, max rows: 1.00 thousand, current rows: 65.41 thousand. (TOO_MANY_ROWS_OR_BYTES)
```

```sql
CREATE TABLE e (id UInt64, s String) ENGINE = MergeTree ORDER BY id;
INSERT INTO e SELECT number, toString(number) FROM numbers(1000000);
SELECT count() FROM e WHERE s LIKE '%9%' SETTINGS max_bytes_to_read = 1000000;
```

```text
Code: 307. DB::Exception: Limit for rows or bytes to read exceeded, max bytes: 976.56 KiB, current bytes: 2.74 MiB: While executing MergeTreeSelect(pool: ReadPool, algorithm: Thread). (TOO_MANY_BYTES)
```

The elapsed time and byte counts in these errors vary slightly between runs. Three details from the `system.settings` descriptions that affect how you set them:

- `max_execution_time` is projected from execution speed. ClickHouse starts estimating after `timeout_before_checking_execution_speed` (10 seconds by default) and stops a query whose estimated time exceeds the limit. The example sets that to `0` to use wall-clock time. The docs also note the timeout can't fire during merging of aggregation states or query analysis, so real run time can be higher than the limit.
- `max_result_rows` is checked per block. With `result_overflow_mode = 'break'` the query returns a partial result instead of an error, but the size is rounded up to a block: the query above with `'break'` returned 65,409 rows for a limit of 1,000. Use `LIMIT` for exact page sizes and treat `max_result_rows` as a backstop.
- `max_bytes_to_read` counts uncompressed bytes. `max_rows_to_read` is the row-count equivalent (error code 158, `TOO_MANY_ROWS`).

`max_memory_usage` (default `0`, unlimited, on self-hosted) is worth adding to the same profile.

## How do I set ClickHouse settings per user, per profile or per query?

ClickHouse applies settings at four levels, and the narrower level wins as long as the user is allowed to change it:

| Level | How | Who controls it |
| --- | --- | --- |
| Settings profile | `CREATE SETTINGS PROFILE ... SETTINGS ...`, or `<profiles>` in `users.xml` | Admin |
| User | `CREATE USER ... SETTINGS ...` or `ALTER USER ... SETTINGS ...` | Admin |
| Session | `SET name = value` | Client, if `readonly` allows it |
| Query | `SELECT ... SETTINGS name = value`, or HTTP URL parameters | Client, if `readonly` allows it |

Put the guardrails in the profile, add per-user overrides with `ALTER USER`, and let the application tighten limits per query. To set a user-level override on top of the profile:

```sql
ALTER USER api_reader SETTINGS PROFILE 'api_profile', max_result_rows = 50000;
SHOW CREATE USER api_reader;
```

```text
CREATE USER api_reader IDENTIFIED WITH sha256_password SETTINGS PROFILE `api_profile`, max_result_rows = 50000
```

Constraints decide whether a client override is accepted. With `max_execution_time = 10 MAX 30` in the profile, a client can lower or raise the timeout up to 30 seconds and no further:

```sql
CREATE SETTINGS PROFILE api_profile SETTINGS readonly = 2, max_execution_time = 10 MAX 30;
SET profile = 'api_profile';
SET max_execution_time = 20;
SET max_execution_time = 60;
```

```text
Code: 452. DB::Exception: Setting max_execution_time shouldn't be greater than 30. (SETTING_CONSTRAINT_VIOLATION)
```

## How do I query ClickHouse over the HTTP API?

ClickHouse's HTTP API is the SQL query endpoint on port 8123 (by default): send the query as the POST body, or as the `query` URL parameter, and read the result in the format named by `FORMAT` or the `X-ClickHouse-Format` header. The "ClickHouse REST API" people search for is this endpoint: SQL over HTTP. The public demo endpoint at `play.clickhouse.com` works the same way:

```bash
curl -H 'X-ClickHouse-User: play' -H 'X-ClickHouse-Format: JSONEachRow' \
  'https://play.clickhouse.com/?' \
  --data-binary "SELECT currentUser() AS u, getSetting('readonly') AS r"
# {"u":"play","r":1}
```

Facts from the [HTTP interface docs](https://clickhouse.com/docs/interfaces/http) that matter for a backend:

- Credentials go in HTTP Basic auth, the `user` and `password` URL parameters, or the `X-ClickHouse-User` and `X-ClickHouse-Key` headers. When people search for a "ClickHouse API key" on the HTTP interface, `X-ClickHouse-Key` is it, and it holds the user's password. The docs advise against URL-parameter credentials because proxies may log them.
- Any setting can be passed as a URL parameter for a single query, as in the `max_execution_time=60` example above.
- The default output format is `TabSeparated`. `X-ClickHouse-Format` overrides a `FORMAT` clause in the query.
- The [permissions docs](https://clickhouse.com/docs/operations/settings/permissions-for-queries) say a request whose method is not `POST` runs with `readonly = 2` if the effective value would otherwise be `0`. Use `POST` for anything that writes.

On 2026-11-08, `play.clickhouse.com`'s `play` user ran ClickHouse 26.10 with `readonly = 1`, `max_execution_time = 60`, `max_result_rows = 1000000`, `max_bytes_to_read = 1000000000000` and `output_format_json_quote_64bit_integers = 0`. It's a working example of the profile-level guardrails described above.

## How do I build an API layer on top of ClickHouse?

Put your own backend between clients and ClickHouse, and have it connect as a readonly user whose profile carries the limits above. Exposing ClickHouse's HTTP endpoint directly to browsers means every client holds database credentials and can send any SQL its grants allow. A backend lets you authenticate your own users, apply tenant filters, choose which queries exist, and pick the JSON encoding your clients need. The checklist:

1. A dedicated user with `readonly = 2` and `GRANT SELECT` on only the tables the API needs.
2. `max_execution_time`, `max_result_rows`, `max_bytes_to_read` and `max_memory_usage` in the profile, with `MAX` constraints.
3. `cancel_http_readonly_queries_on_client_close = 1` so abandoned requests stop.
4. `output_format_json_quote_64bit_integers = 1` for JavaScript clients, and `output_format_json_quote_decimals = 1` if you have wide decimals.

The [ClickHouse API page](/clickhouse-api) covers serving typed endpoints from these queries.

## Using these settings from TypeScript and Python with hypequery

hypequery's TypeScript query builder, `@hypequery/clickhouse`, sends `output_format_json_quote_64bit_integers = 1` with every query by default, so `Int64` and wider values, including `count()` and integer `sum()`, arrive as exact strings and are typed as `string`:

```ts
import { createQueryBuilder, rawAs } from '@hypequery/clickhouse';
import type { IntrospectedSchema } from './schema';

const db = createQueryBuilder<IntrospectedSchema>({
  url: process.env.CLICKHOUSE_URL!,
  username: process.env.CLICKHOUSE_USERNAME!,
  password: process.env.CLICKHOUSE_PASSWORD!,
  database: process.env.CLICKHOUSE_DATABASE!,
});

const rows = await db
  .table('events')
  .select([rawAs<string, 'day'>('toStartOfDay(created_at)', 'day')])
  .count('id', 'events')
  .where((expr) => expr.raw('created_at >= now() - INTERVAL 1 DAY'))
  .groupBy('day')
  .settings({ max_execution_time: 5 })
  .execute();
// rows: { day: string; events: string }[]
```

The adapter only adds that setting when you haven't set `output_format_json_quote_64bit_integers` yourself in `clickhouse_settings` or per query, so explicit settings win. With the user types from earlier:

- A `readonly = 2` user, or an unrestricted one, works without changes, and so does `.settings({...})`.
- A `readonly = 1` user works if its profile already sets `output_format_json_quote_64bit_integers = 1`.
- Any other `readonly = 1` user rejects the setting with code 164. hypequery turns that specific rejection into an error telling you to set `integerJsonEncoding: 'server-default'`. Other readonly errors pass through unchanged.

```ts
const db = createQueryBuilder<IntrospectedSchema>({
  url: process.env.CLICKHOUSE_URL!,
  username: process.env.CLICKHOUSE_USERNAME!,
  password: process.env.CLICKHOUSE_PASSWORD ?? '',
  integerJsonEncoding: 'server-default',
});
```

`'server-default'` leaves the setting out rather than sending `0`, and doesn't probe the server or retry. The server's own setting then decides, which on a default 26.6 server means 64-bit values come back as JSON numbers that can lose precision above 2^53 and won't match the generated `string` types. Fixing the profile keeps the safe default. Per-query `.settings({...})` on a `readonly = 1` user follow the same rule: rejected unless the value matches the profile. `execute()` also accepts an `abortSignal`; the server stops the query on a dropped connection only if `cancel_http_readonly_queries_on_client_close = 1`.

The Python package attaches `readonly = 1`, `max_execution_time`, `max_result_rows`, `max_result_bytes` and `max_threads` to every dataset query. For a `readonly = 2` user it leaves out only the `readonly` setting and keeps every limit; for a `readonly = 1` user you set the same limits in the profile. The [readonly users reference](/docs/reference/readonly-users) has the details for both languages.

## Related

- [Read-only ClickHouse users in hypequery](/docs/reference/readonly-users)
- [Building a ClickHouse API](/clickhouse-api)
- [ClickHouse with TypeScript](/clickhouse-typescript)
- [ClickHouse with Python](/clickhouse-python)
- [Multi-tenant analytics on ClickHouse](/clickhouse-multi-tenant-analytics)
- [ClickHouse pagination in TypeScript](/blog/clickhouse-pagination-typescript)
- ClickHouse docs: [Permissions for queries](https://clickhouse.com/docs/operations/settings/permissions-for-queries), [Constraints on settings](https://clickhouse.com/docs/operations/settings/constraints-on-settings), [HTTP interface](https://clickhouse.com/docs/interfaces/http), [Settings reference](https://clickhouse.com/docs/operations/settings/settings)
