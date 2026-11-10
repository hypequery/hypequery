# Latency and status buckets in ClickHouse with multiIf, as reusable dataset dimensions

Define latency and status-class buckets once with multiIf, keep them in bucket order, and see how CASE, transform and roundDown compare on real requests.

**The short answer:** `multiIf(cond1, then1, cond2, then2, ..., else)` returns the value for the first condition that is true, so list narrow conditions before wide ones: `multiIf(latency_ms < 100, '< 100 ms', latency_ms < 250, '100-250 ms', ..., '>= 1 s')`. `CASE WHEN` is rewritten to exactly this `multiIf`, so pick whichever reads better. Use `transform` for exact value-to-label maps, and `roundDown(x, [0, 100, 250, ...])` when a numeric lower bound is enough.

## Demo

```text
Requests per latency bucket, 2026-10-25 to 2026-10-31

order  latencyBucket  requests  serverErrors  serverErrorRate
    1  < 100 ms           8396             7            0.08%
    2  100-250 ms        15219           397            2.61%
    3  250-500 ms         4835           335            6.93%
    4  500 ms-1 s         2798            49            1.75%
    5  >= 1 s             1086             0            0.00%
```

## Install

```bash
npx hypequery create multiif-bucketing -y
cd multiif-bucketing
docker compose -f ../examples/_seed/docker-compose.yml up -d --wait && pnpm seed   # or set CLICKHOUSE_* for your own ClickHouse
pnpm install
pnpm dev
```

## What it shows

- **Buckets as dataset dimensions** (`src/dataset.ts`): `latencyBucket` and `statusClass` are `multiIf` expressions on `dimension.string({ sql })`, defined once for every dashboard, API and agent.
- **A sort key next to the label**: `latencyBucketOrder` uses the same conditions and returns 1 to 5, because the labels sort as `100-250 ms`, `250-500 ms`, `500 ms-1 s`, `< 100 ms`, `>= 1 s`.
- **Measures over buckets** (`src/recipe.ts`): requests, server errors (a filtered count) and a derived error rate per bucket.
- **Equivalence and pitfalls pinned** (`src/smoke.test.ts`): `CASE WHEN` and `roundDown` give identical counts; condition order, boundaries, types and `transform` defaults each have an assertion.

## Key file

```ts
const LATENCY_BUCKET = `multiIf(latency_ms < 100, '< 100 ms', latency_ms < 250, '100-250 ms', latency_ms < 500, '250-500 ms', latency_ms < 1000, '500 ms-1 s', '>= 1 s')`;
const LATENCY_BUCKET_ORDER = `multiIf(latency_ms < 100, 1, latency_ms < 250, 2, latency_ms < 500, 3, latency_ms < 1000, 4, 5)`;
// Order matters: 429 is also >= 400, so it must be tested first.
const STATUS_CLASS = `multiIf(status_code >= 500, 'server_error', status_code = 429, 'rate_limited', status_code >= 400, 'client_error', 'ok')`;

export const Requests = dataset('requests', {
  source: 'events',
  timeKey: 'occurred_at',
  dimensions: {
    eventId: dimension.number({ column: 'event_id' }),
    occurredAt: dimension.timestamp({ column: 'occurred_at' }),
    statusCode: dimension.number({ column: 'status_code' }),
    latencyBucket: dimension.string({ sql: LATENCY_BUCKET, dependencies: ['latency_ms'] }),
    latencyBucketOrder: dimension.number({ sql: LATENCY_BUCKET_ORDER, dependencies: ['latency_ms'] }),
    statusClass: dimension.string({ sql: STATUS_CLASS, dependencies: ['status_code'] }),
  },
  measures: {
    requests: measure.count('eventId'),
    serverErrors: measure.count('eventId', { filters: [gte('statusCode', 500)] }),
    serverErrorRate: measure.derived({
      uses: { errors: 'serverErrors', requests: 'requests' },
      formula: ({ errors, requests }) => divide(errors, nullIfZero(requests)),
    }),
  },
});
```

## multiIf, CASE, transform or roundDown?

| You have | Use | Example |
| --- | --- | --- |
| Ranges or mixed conditions | `multiIf` (or `CASE WHEN`, the same function) | latency buckets, status classes |
| Exact values to labels | `transform(x, [from...], [to...], default)` | `transform(status_code, [429], ['rate_limited'], 'other')` |
| Exact values of one expression | `CASE x WHEN ... END` | rewritten to `caseWithExpression(x, ...)` |
| A numeric bucket key from bounds | `roundDown(x, [0, 100, 250, 500, 1000])` | returns the lower bound: 0, 100, 250, ... |
| Equal-width buckets | `intDiv(x, 100) * 100` | 0, 100, 200, ... |

`EXPLAIN SYNTAX` on 25.8 shows `CASE WHEN latency_ms < 100 THEN 'fast' ELSE 'slow' END` as `multiIf(latency_ms < 100, 'fast', 'slow')`, and `CASE status_code WHEN 429 THEN ...` as `caseWithExpression(status_code, 429, ...)`.

## Pitfalls, with seed numbers

| Pitfall | What happens on the seed (2026-10-25 to 2026-10-31) |
| --- | --- |
| A wide condition first | `multiIf(latency_ms < 500, ..., latency_ms < 100, ...)` puts all 28,450 sub-500 ms requests in the first branch; the `< 100 ms` branch never matches. |
| `>= 400` before `= 429` | Status classes collapse to `client_error` 1,925 and `ok` 30,409: the 95 rate-limited and 788 server errors disappear into `client_error`. In the right order: 1,042 / 95 / 788 / 30,409. |
| Sorting by the label | `ORDER BY latencyBucket` returns `100-250 ms` first and `< 100 ms` fourth. Order by `latencyBucketOrder`. |
| Boundaries | 191 requests took exactly 100 ms; with `< 100` they land in `100-250 ms`. Decide half-open or closed once, in the dataset. |
| Branch types | `multiIf(latency_ms < 100, 'fast', 1)` fails with `NO_COMMON_TYPE` (no supertype for String and UInt8). A `NULL` branch makes the result `Nullable(String)`. |
| `transform` without a default | Unmatched values pass through unchanged: `transform(200, [429], [1])` returns 200. Always give the default when mapping to labels. |
| `roundDown` below the first bound | Returns the first bound, not an error: `roundDown(5, [10, 100])` is 10. Start the bounds at 0 (or the type's minimum). |

## Architecture

```text
events.latency_ms  ──multiIf──▶ latencyBucket (label)   + latencyBucketOrder (sort key)
events.status_code ──multiIf──▶ statusClass
                                     │
src/recipe.ts   analytics.toSQL(Requests, query)   ──▶ expected.sql  (asserted in CI)
                analytics.execute(Requests, query) ──▶ output.json   (asserted exactly in CI)
```

## Adapt it

- **Per event type.** Add `eventType` as a dimension and group by it with the bucket; the bucket definition does not change.
- **Change the cut-offs in one place.** The SQL strings live in `src/dataset.ts`; every caller picks up new boundaries on deploy. Change the label and order expressions together.
- **Rollups.** In a materialized view target, store `roundDown(latency_ms, [...])` as a `UInt32` column; it sorts, compresses well and maps back to labels with `transform`.
- **Histogram instead of buckets.** For a quick distribution, `histogram(10)(latency_ms)` returns adaptive bins; buckets with fixed edges are what dashboards and SLOs want.

## Related recipes

- [p95-latency](../p95-latency): percentiles of the same latency column.
- [iso-week-bucketing](../iso-week-bucketing): bucketing in time rather than by value.

## Related examples

- [nextjs-dashboard](../nextjs-dashboard): where a latency distribution chart would live.

Tested on ClickHouse 25.8 with `@hypequery/datasets` 0.29 and `@hypequery/clickhouse` 2.14.
