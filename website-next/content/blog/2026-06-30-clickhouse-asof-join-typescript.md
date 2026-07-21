---
title: "ClickHouse ASOF JOIN — Nearest-Match Time-Series Joins in TypeScript"
description: "ASOF JOIN matches each row to the closest earlier row in another table — trades to quotes, errors to deploys, readings to calibrations. Here's how it works in ClickHouse SQL and how to run it from a TypeScript app with hypequery."
seoTitle: "ClickHouse ASOF JOIN: Nearest-Match Time-Series Joins in TypeScript"
seoDescription: "ClickHouse ASOF JOIN joins each row to the nearest matching row by timestamp. Learn the syntax, the one-inequality rule, and how to use it from TypeScript."
pubDate: 2026-06-30
heroImage: ""
slug: clickhouse-asof-join-typescript
status: published
tags:
  - ClickHouse
  - TypeScript
---

`ASOF JOIN` is ClickHouse's nearest-match join for time series. Instead of requiring an exact key match, it joins each left-side row to the **closest** right-side row that satisfies an inequality — almost always "the most recent row at or before this timestamp."

**Short answer:** use `ASOF JOIN` when each row in one table needs to be paired with the latest preceding row in another table:

```sql
SELECT t.trade_id, t.price, q.bid, q.ask
FROM trades t
ASOF JOIN quotes q
  ON t.symbol = q.symbol AND t.ts >= q.ts
```

For every trade, ClickHouse finds the quote with the same `symbol` whose `ts` is the largest value still `<=` the trade's `ts` — the prevailing quote at the moment of the trade. The join condition must contain at least one equality (the grouping key) and **exactly one** inequality (the nearest-match condition). That's the whole feature.

hypequery's typed builder does not have an `asofJoin` method — this is one of the ClickHouse-specific clauses where you write real SQL. Below we cover the SQL semantics, then the two honest ways to run it from TypeScript (a raw-SQL CTE inside the builder, or the official client for that one query), and when the `argMax` pattern is the simpler answer. If you don't have a typed ClickHouse setup yet, the [quick start](/docs/quick-start) gets you a generated schema in a few minutes, and the [time-series guide](/clickhouse-time-series) covers the surrounding patterns.

## What ASOF JOIN actually does

A normal join asks "which rows have equal keys?" An `ASOF JOIN` asks "for each left row, which single right row is *nearest* under this inequality, within the same equality group?"

Concretely, with `ON t.symbol = q.symbol AND t.ts >= q.ts`:

1. Partition both tables by the equality keys (`symbol`).
2. For each left row, scan that partition of the right table for rows where `q.ts <= t.ts`.
3. Keep only the one with the **maximum** `q.ts` — the closest match.
4. If no right row qualifies, the left row is dropped (`ASOF JOIN`) or kept with defaults (`ASOF LEFT JOIN`).

The rules:

- **At least one equality condition** — the key that scopes the match (`symbol`, `service`, `sensor_id`).
- **Exactly one inequality condition** — `>=`, `>`, `<=`, or `<` on a well-ordered column (DateTime, Date, integers, floats).
- The join key columns can't be `Nullable`.
- Like other ClickHouse joins, the right-side table is loaded into memory (sorted by the inequality column for the nearest-match scan), so keep the smaller table on the right.

There's also a `USING` shorthand where the last column listed is the inequality column with `>=` semantics:

```sql
FROM trades ASOF JOIN quotes USING (symbol, ts)
```

If you need a refresher on how ClickHouse executes standard joins — memory model, which side to put where, when to denormalize instead — that's covered in [ClickHouse JOIN types in TypeScript](/blog/clickhouse-joins-typescript). This post assumes that and focuses only on the nearest-match case.

## The canonical example: trades matched to the latest quote

Two tables. Quotes arrive continuously; trades happen at arbitrary moments between quotes.

```sql
CREATE TABLE quotes (
  symbol LowCardinality(String),
  ts DateTime64(3),
  bid Float64,
  ask Float64
) ENGINE = MergeTree()
ORDER BY (symbol, ts);

CREATE TABLE trades (
  trade_id UInt64,
  symbol LowCardinality(String),
  ts DateTime64(3),
  price Float64,
  quantity UInt32
) ENGINE = MergeTree()
ORDER BY (symbol, ts);
```

The question "what was the quote when each trade executed?" has no exact-match answer — trade timestamps almost never equal quote timestamps. `ASOF JOIN` is the direct expression of it:

```sql
SELECT
  t.trade_id,
  t.symbol,
  t.price,
  t.ts AS trade_ts,
  q.bid,
  q.ask,
  q.ts AS quote_ts
FROM trades t
ASOF JOIN quotes q
  ON t.symbol = q.symbol AND t.ts >= q.ts
WHERE t.ts >= now() - INTERVAL 1 DAY
```

Each output row is one trade plus the prevailing quote for that symbol at that instant. `quote_ts` tells you how stale the match was — useful for flagging trades that executed long after the last quote.

Use `ASOF LEFT JOIN` when left rows without any earlier match should survive with default values instead of disappearing — for example, trades in the first minutes of the day before any quote arrived.

## The same shape shows up outside finance

The trade/quote pairing is one instance of a general pattern: **point-in-time enrichment**. Two more that come up in product engineering:

**Errors matched to the most recent deploy.** Which release was live when each error fired?

```sql
SELECT
  e.error_id,
  e.service,
  e.message,
  e.ts,
  d.version AS deployed_version,
  d.ts AS deployed_at
FROM errors e
ASOF JOIN deploys d
  ON e.service = d.service AND e.ts >= d.ts
```

Group the result by `deployed_version` and you have error counts per release without ever storing the version on the error event itself.

**Sensor readings matched to the calibration in effect.** Each reading should be adjusted by the latest calibration for that sensor at or before the reading's timestamp: `ON r.sensor_id = c.sensor_id AND r.ts >= c.ts`. Same join, different domain.

The common thread: one table records sparse state changes (quotes, deploys, calibrations), the other records dense events, and you need each event annotated with the state that was current when it happened.

## Running ASOF JOIN from TypeScript with hypequery

hypequery's builder covers `INNER`, `LEFT`, `RIGHT`, and `FULL` joins with typed columns, but there is **no `asofJoin` method**. Rather than pretend otherwise, here are the two escape hatches that work today.

### Option 1: a raw-SQL CTE inside the typed builder

`.withCTE()` accepts either another builder or a plain SQL string. That means you can express the ASOF match as a CTE, then do the rest of the query — the standard equality joins, filters, ordering — in the typed builder:

```ts
import { createQueryBuilder } from '@hypequery/clickhouse';
import type { IntrospectedSchema } from './generated/schema.js';

const db = createQueryBuilder<IntrospectedSchema>({
  url: process.env.CLICKHOUSE_URL!,
  username: process.env.CLICKHOUSE_USERNAME!,
  password: process.env.CLICKHOUSE_PASSWORD,
  database: process.env.CLICKHOUSE_DATABASE!,
});

const rows = await db
  .table('trades')
  .withCTE(
    'trade_quotes',
    `SELECT t.trade_id, q.bid, q.ask, q.ts AS quote_ts
     FROM trades t
     ASOF JOIN quotes q ON t.symbol = q.symbol AND t.ts >= q.ts`
  )
  .leftJoin('trade_quotes', 'trade_id', 'trade_quotes.trade_id')
  .select([
    'trade_id',
    'symbol',
    'price',
    'trade_quotes.bid as bid',
    'trade_quotes.ask as ask',
  ])
  .where('symbol', 'eq', 'AAPL')
  .orderBy('ts', 'DESC')
  .limit(100)
  .execute();
```

The ASOF logic lives in one clearly-marked SQL string; the filters, column selection, and pagination stay typed. One caveat: columns coming out of the CTE aren't part of your generated schema, so TypeScript can't check `trade_quotes.bid` the way it checks `trades.price`. Keep the raw surface small and the checked surface large.

### Option 2: drop to @clickhouse/client for this one query

If the whole query is the ASOF join and there's no builder-shaped work around it, using the official client directly is the simpler call:

```ts
import { createClient } from '@clickhouse/client';

const clickhouse = createClient({
  url: process.env.CLICKHOUSE_URL!,
  username: process.env.CLICKHOUSE_USERNAME!,
  password: process.env.CLICKHOUSE_PASSWORD,
  database: process.env.CLICKHOUSE_DATABASE!,
});

const resultSet = await clickhouse.query({
  query: `
    SELECT e.error_id, e.service, e.ts, d.version AS deployed_version
    FROM errors e
    ASOF JOIN deploys d
      ON e.service = d.service AND e.ts >= d.ts
    WHERE e.ts >= {from:DateTime}
  `,
  query_params: { from: '2026-07-17 00:00:00' },
  format: 'JSONEachRow',
});

const rows = await resultSet.json<{
  error_id: string;
  service: string;
  ts: string;
  deployed_version: string;
}>();
```

This is not a workaround to be embarrassed about — hypequery is built on `@clickhouse/client`, and the practical division of labor is: typed builder for the 95% of queries it models well, raw client for ClickHouse-specific clauses it doesn't. The [hypequery vs @clickhouse/client comparison](/compare/hypequery-vs-clickhouse-client) goes deeper on where that line sits.

## When argMax is the better tool

Before reaching for `ASOF JOIN`, check whether you actually need a per-row point-in-time match. A lot of "latest value" questions are really "latest value **per key**, once" — and that's `argMax`, which the builder supports natively:

```ts
// Current quote per symbol — one row per symbol, not per trade
const latestQuotes = await db
  .table('quotes')
  .select(['symbol'])
  .argMax('bid', 'ts', 'latest_bid')
  .argMax('ask', 'ts', 'latest_ask')
  .max('ts', 'as_of')
  .groupBy('symbol')
  .execute();
```

`argMax(bid, ts)` returns the `bid` value from the row where `ts` is maximal within each group. It answers "what is the latest quote per symbol right now?" in a single typed aggregation — no join, no raw SQL, no memory-resident right table.

The distinction:

| Question | Tool |
|----------|------|
| Latest value per key, evaluated once | `argMax` in the builder |
| Each event paired with the state current *at that event's time* | `ASOF JOIN` in SQL |
| Events enriched with metadata by exact key | `.innerJoin()` / `.leftJoin()` in the builder |

If every trade needs the quote *at its own timestamp*, `argMax` can't help — you'd get the same single latest quote for every trade. That per-row historical alignment is exactly what `ASOF JOIN` exists for.

## Performance notes

- **The right table lives in memory.** Same hash-join model as other ClickHouse joins, plus per-key ordering work for the inequality column. Put the sparse state table (quotes, deploys) on the right and pre-filter it — join against yesterday's quotes, not five years of them.
- **Filter both sides early.** A `WHERE` on the left table's time range plus a bounded right side keeps the join tractable. ASOF over two unfiltered billion-row tables is a memory incident, not a query.
- **Consider materializing hot paths.** If the same ASOF enrichment runs on every dashboard load, pre-joining at insert time with a [materialized view](/blog/clickhouse-materialized-views-typescript) turns a per-query join into a plain filtered read.

## Where to go from here

- [ClickHouse JOIN types in TypeScript](/blog/clickhouse-joins-typescript) — the standard INNER/LEFT/RIGHT/FULL and ARRAY JOIN reference this post builds on.
- [ClickHouse time-series guide](/clickhouse-time-series) — bucketing, gap filling, and the rest of the time-series toolkit.
- [ClickHouse query builder](/clickhouse-query-builder) — what the typed builder covers natively, so you know when you need an escape hatch.
- [Quick start](/docs/quick-start) — generate types from your schema and get the typed baseline in place.
