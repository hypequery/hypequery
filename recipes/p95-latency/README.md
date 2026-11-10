# p95 latency per event type in ClickHouse with a typed dataset

Define p50, p95 and p99 latency once as dataset measures and get the quantile() SQL, the result on a million events, and the exactness trade-off.

## Demo

```text
p95 latency per event type, 2026-10-25 to 2026-10-31

eventType   events   p50   p95     p99
export        1233  1128  2609    3451
query_run     4851   514  1080    1405
error          984   244   513     681
login         2644   210   445     603
api_call      8073   152   324     431
page_view    14549   102   219     290
```

## Install

```bash
npx @hypequery/cli create p95-latency -y
cd p95-latency
docker compose -f ../examples/_seed/docker-compose.yml up -d --wait && pnpm seed   # or set CLICKHOUSE_* for your own ClickHouse
pnpm install
pnpm dev
```

## What it shows

- **Percentiles as measures** (`src/dataset.ts`): `measure.median`, `measure.percentile(field, 0.95)` and `measure.percentile(field, 0.99)` next to a plain `count`, named once for every caller.
- **One semantic query, one SQL statement** (`src/recipe.ts`): group by event type, order by p95; hypequery renders `quantile(0.95)(events.latency_ms)` and parameterises the date range.
- **The generated SQL is asserted** (`expected.sql`): the smoke test fails if a package upgrade changes it.
- **The exactness trade-off** (`src/smoke.test.ts`): `quantile` is approximate; the test checks it lands within 3% of `quantileExact` over the same rows, and documents when to swap.

## Key file

```ts
export const query: DatasetQuery = {
  dimensions: ['eventType'],
  measures: ['events', 'p50LatencyMs', 'p95LatencyMs', 'p99LatencyMs'],
  filters: [between('occurredAt', RANGE[0], RANGE[1])],
  orderBy: [{ field: 'p95LatencyMs', direction: 'desc' }],
};

const result = await analytics.execute(Events, query);
```

## Architecture

```text
src/dataset.ts   dataset('events') with percentile measures
      │
src/recipe.ts    analytics.toSQL(Events, query)  ──▶  expected.sql   (asserted in CI)
                 analytics.execute(Events, query) ──▶  output.json    (asserted in CI, ±2%)
```

## Adapt it

- **Exact when it matters.** `quantile` samples up to 8,192 values per group. For SLO reporting on small groups, or when two teams must agree to the millisecond, use `quantileExact` in SQL; in a dataset today that means a plain `measure.max`/`min` plus a `rawQuery` for the exact figure, or a rollup table that stores `quantilesState`.
- **Per tenant.** Add `tenantId` to `dimensions` in the query, or set `tenantKey: 'tenant_id'` on the dataset to scope every call to one tenant.
- **Over time.** Replace `dimensions: ['eventType']` with `by: 'day'` to get a daily p95 series; the measures do not change.
- **Pre-aggregate.** For dashboards over billions of rows, store `quantileTDigestState(latency_ms)` in an AggregatingMergeTree target (see the materialized view example) and read it with a `-Merge` query.

## Related recipes

- [retention-cohorts](../retention-cohorts): the same dataset pattern over a cohort view.

## Related examples

- [materialized-view-rollups](../materialized-view-rollups): pre-aggregate the same events.
- [nextjs-dashboard](../nextjs-dashboard): the p95 tile on a dashboard.

Tested on ClickHouse 25.8 with `@hypequery/datasets` 0.29 and `@hypequery/clickhouse` 2.14.
