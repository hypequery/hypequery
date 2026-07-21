---
title: "ClickHouse GROUP BY and Aggregations in TypeScript"
description: "How to write GROUP BY queries against ClickHouse from TypeScript: sum, avg, count, countDistinct, quantile, argMax, WITH TOTALS, HAVING, and time bucketing — all with typed results."
seoTitle: "ClickHouse GROUP BY in TypeScript: Aggregations, HAVING, WITH TOTALS"
seoDescription: "Write ClickHouse GROUP BY queries in TypeScript with typed aggregations: sum, avg, count, countDistinct, quantile, argMax, WITH TOTALS, HAVING, and time bucketing."
pubDate: 2026-05-28
heroImage: ""
slug: clickhouse-group-by-typescript
status: published
tags:
  - ClickHouse
  - TypeScript
---

Almost every analytics query you run against ClickHouse is a GROUP BY. Revenue by region, events by day, p95 latency by endpoint — the shape is always the same: pick dimensions, aggregate measures, group, sort.

**Short answer:** with hypequery you chain typed aggregation methods (`.sum()`, `.avg()`, `.count()`, `.quantile()`, and friends) and then call `.groupBy()` explicitly with your dimension columns — exactly as you would write the SQL:

```ts
import { createQueryBuilder } from '@hypequery/clickhouse';
import type { IntrospectedSchema } from './generated/schema.js';

const db = createQueryBuilder<IntrospectedSchema>({
  url: process.env.CLICKHOUSE_URL!,
  username: process.env.CLICKHOUSE_USERNAME!,
  password: process.env.CLICKHOUSE_PASSWORD,
  database: process.env.CLICKHOUSE_DATABASE!,
});

const revenueByRegion = await db
  .table('orders')
  .select(['region'])
  .sum('total', 'revenue')
  .count('id', 'order_count')
  .groupBy('region')
  .orderBy('revenue', 'DESC')
  .execute();
```

Which produces:

```sql
SELECT region, SUM(total) AS revenue, COUNT(id) AS order_count
FROM orders
GROUP BY region
ORDER BY revenue DESC
```

One habit worth keeping: call `.groupBy()` yourself, with every non-aggregated column you select — the same discipline SQL asks of you. It keeps the mapping between your TypeScript and the generated SQL obvious, and every example in this post follows it.

The rest of this post walks through every aggregation the builder supports natively, plus the three GROUP BY companions that matter most in ClickHouse: time bucketing, `WITH TOTALS`, and `HAVING`. If you want to run these against your own schema first, the [quick start](/docs/quick-start) gets you from `npm install` to typed queries in a few minutes, and the [ClickHouse query builder](/clickhouse-query-builder) page covers the builder end to end.

## The working schema

Examples below use two tables from a multi-tenant SaaS:

```sql
CREATE TABLE orders (
  id String,
  tenant_id UInt32,
  region String,
  status String,
  total Float64,
  created_at DateTime
) ENGINE = MergeTree()
ORDER BY (tenant_id, created_at);

CREATE TABLE api_requests (
  endpoint String,
  duration_ms UInt32,
  created_at DateTime
) ENGINE = MergeTree()
ORDER BY (endpoint, created_at);
```

Running `hypequery generate` against a database containing these tables produces the `IntrospectedSchema` type used above, so column names and comparison values are checked at compile time.

## Counting: count, countDistinct, and the uniq question

`.count(column, alias)` maps to ClickHouse [`count()`](/clickhouse/functions/count):

```ts
const ordersPerStatus = await db
  .table('orders')
  .select(['status'])
  .count('id', 'orders')
  .groupBy('status')
  .execute();
```

Two ClickHouse behaviors to keep in mind:

- `count()` with no argument counts all rows; `count(col)` skips rows where `col` is NULL. If a count looks mysteriously low, check whether you're counting a `Nullable` column.
- `.countDistinct(column, alias)` generates `count(DISTINCT col)`, which ClickHouse executes as [`uniqExact`](/clickhouse/functions/uniq-exact) by default — exact, but memory-hungry on high-cardinality columns. For big distinct counts where a ~1% error is fine (daily active users, unique visitors), ClickHouse's approximate [`uniq()`](/clickhouse/functions/uniq) is much cheaper. `uniq` isn't a dedicated builder method, so reach for the `selectExpr` escape hatch:

```ts
import { selectExpr } from '@hypequery/clickhouse';

const customersByRegion = await db
  .table('orders')
  .select(['region', selectExpr('uniq(id)', 'approx_customers')])
  .groupBy('region')
  .countDistinct('id', 'exact_customers')
  .execute();
```

Both counts come back on the same row, which is also a handy way to sanity-check how far off the approximation is for your data before committing to `uniq` on a dashboard.

## Sums, averages, and extremes

`.sum()`, `.avg()`, `.min()`, and `.max()` all take `(column, alias)` and map directly to [`sum`](/clickhouse/functions/sum), [`avg`](/clickhouse/functions/avg), [`min`](/clickhouse/functions/min), and [`max`](/clickhouse/functions/max):

```ts
const orderStats = await db
  .table('orders')
  .select(['region'])
  .sum('total', 'revenue')
  .avg('total', 'avg_order_value')
  .min('total', 'smallest_order')
  .max('total', 'largest_order')
  .groupBy('region')
  .execute();
```

`min` and `max` tell you the extreme *value*. They don't tell you which row produced it — for that, ClickHouse has `argMax`/`argMin`, and the builder supports both natively:

```ts
// For each region: the id of the most recent order
const latestOrders = await db
  .table('orders')
  .select(['region'])
  .argMax('id', 'created_at', 'latest_order_id')
  .max('created_at', 'latest_order_at')
  .groupBy('region')
  .execute();
```

`.argMax(column, argColumn, alias)` returns the value of `column` on the row where `argColumn` is largest; `.argMin()` is the mirror image. This pattern shows up constantly in ClickHouse — "latest row per group" without a self-join — and it's also the standard workaround for deduplicating ReplacingMergeTree data without paying the `FINAL` cost.

## Percentiles: quantile

Averages hide tail latency; percentiles don't. `.quantile(column, level, alias)` takes a level between 0 and 1 and generates ClickHouse's approximate [`quantile`](/clickhouse/functions/quantile):

```ts
const latencyByEndpoint = await db
  .table('api_requests')
  .select(['endpoint'])
  .quantile('duration_ms', 0.5, 'p50')
  .quantile('duration_ms', 0.95, 'p95')
  .quantile('duration_ms', 0.99, 'p99')
  .count('endpoint', 'requests')
  .groupBy('endpoint')
  .orderBy('p95', 'DESC')
  .execute();
```

Note that `quantile` is approximate (reservoir sampling). That's the right default for latency dashboards — it's fast and the error is small. If you need exact quantiles, that's `quantileExact` in raw SQL via `selectExpr`.

## Spread: stddev and variance

For anomaly detection or "is this metric noisier than usual" questions, the builder exposes `.stddev(column, alias)` (sample standard deviation, `stddevSamp`) and `.variance(column, alias)`:

```ts
const orderSpread = await db
  .table('orders')
  .select(['region'])
  .avg('total', 'avg_total')
  .stddev('total', 'stddev_total')
  .variance('total', 'variance_total')
  .groupBy('region')
  .execute();
```

## Grouping by time: groupByTimeInterval

Time-series charts are GROUP BY over a bucketed timestamp. The builder's `.groupByTimeInterval(column, interval, method?)` handles the GROUP BY side: it adds `toStartOfInterval(created_at, INTERVAL 1 DAY)` (or another `toStartOf*` function) to the GROUP BY clause. You still select the bucket expression you want returned — `selectExpr` again:

```ts
const dailyRevenue = await db
  .table('orders')
  .select([selectExpr('toStartOfInterval(created_at, INTERVAL 1 DAY)', 'day')])
  .groupByTimeInterval('created_at', '1 day')
  .sum('total', 'revenue')
  .orderBy('day', 'ASC')
  .execute();
```

```sql
SELECT toStartOfInterval(created_at, INTERVAL 1 DAY) AS day, SUM(total) AS revenue
FROM orders
GROUP BY toStartOfInterval(created_at, INTERVAL 1 DAY)
ORDER BY day ASC
```

The method defaults to `toStartOfInterval`, so `'1 day'`, `'15 minute'`, and `'1 week'` all work with the same call. The optional third argument switches to a fixed-granularity function — `'toStartOfHour'`, `'toStartOfDay'`, `'toStartOfMonth'`, and the rest of the `toStartOf*` family — when you want calendar-aligned buckets (the interval string is ignored for those, since the function name carries the granularity):

```ts
const monthlyRevenue = await db
  .table('orders')
  .select([selectExpr('toStartOfMonth(created_at)', 'month')])
  .groupByTimeInterval('created_at', '1 month', 'toStartOfMonth')
  .sum('total', 'revenue')
  .execute();
```

Bucketing behavior, alias rules, and the DateTime-comes-back-as-a-string detail are covered in depth in [ClickHouse toStartOfInterval with GROUP BY in TypeScript](/blog/clickhouse-tostartofinterval-typescript).

## WITH TOTALS: the grand-total row for free

`WITH TOTALS` is a distinctly ClickHouse feature: alongside the grouped rows, ClickHouse computes one extra row containing the aggregation over *all* rows — the grand total — in the same query. No second round trip, no summing on the client.

```sql
SELECT region, sum(total) AS revenue
FROM orders
GROUP BY region WITH TOTALS
```

In the builder it's a single call:

```ts
const revenueWithTotals = await db
  .table('orders')
  .select(['region'])
  .sum('total', 'revenue')
  .groupBy('region')
  .withTotals()
  .execute();
```

This is exactly what dashboard summary rows want — "revenue by region, plus company-wide total" — and ClickHouse computes the totals row in the same pass over the data. If you've ever fired two queries (one grouped, one ungrouped) to render a table with a footer, `.withTotals()` replaces the second one.

## Filtering groups: having

`WHERE` filters rows before aggregation; `HAVING` filters groups after. `.having(condition, params?)` takes a SQL condition string, with `?` placeholders bound safely from the params array:

```ts
const bigRegions = await db
  .table('orders')
  .select(['region'])
  .sum('total', 'revenue')
  .count('id', 'order_count')
  .groupBy('region')
  .having('sum(total) > ?', [100000])
  .orderBy('revenue', 'DESC')
  .execute();
```

The condition is raw SQL by design — HAVING clauses reference aggregate expressions, which don't exist as typed columns. Keep row-level filters in `.where()` (they're fully typed, and ClickHouse can use them to skip data) and reserve `.having()` for conditions on aggregate results.

## Collecting values per group: groupArray

One more GROUP BY companion worth knowing: [`groupArray()`](/clickhouse/functions/group-array) collects a column's values into an array per group — the top events per user, the sequence of statuses per order. It isn't a dedicated builder method, so use `selectExpr` for it:

```ts
const statusHistory = await db
  .table('orders')
  .select(['region', selectExpr('groupArray(status)', 'statuses')])
  .groupBy('region')
  .execute();
```

## What aggregation results look like at runtime

ClickHouse returns some types in ways that surprise TypeScript developers, and hypequery's generated types encode the reality rather than the wish:

- `count()`, `countDistinct()`, and integer `sum()` results are `UInt64`/`Int64` under the hood and arrive as **strings** in JavaScript (they can exceed `Number.MAX_SAFE_INTEGER`).
- `DateTime` buckets from `groupByTimeInterval` arrive as strings like `"2026-07-18 00:00:00"`.
- Aggregates over `Nullable(T)` columns can be `null` when a group has no non-NULL values.

Because the builder's result types reflect this, `Number(row.order_count)` versus `row.order_count` is a decision you make consciously at the edge, not a runtime surprise in production.

## Where to go from here

- [ClickHouse filter operators in TypeScript](/blog/clickhouse-filter-operators-typescript) — the `.where()` side of every query on this page
- [ClickHouse joins in TypeScript](/blog/clickhouse-joins-typescript) — grouping across joined tables
- [ClickHouse for time series](/clickhouse-time-series) — where GROUP BY time bucketing becomes the whole workload
- [Quick start](/docs/quick-start) — generate types from your schema and run your first grouped query
