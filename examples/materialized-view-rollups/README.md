# Materialized view rollups: incremental vs refreshable

Pre-aggregate a million events two ways, incremental and refreshable, and query both through one typed hypequery dataset.

## Demo

```text
Events per day, 2026-10-25 to 2026-10-31

Raw events table (62 ms):            Incremental rollup, events_daily (20 ms):
period      events  uniqueUsers       period      events  uniqueUsers
2026-10-26  5551    1186              2026-10-26  5551    1186
2026-10-27  5548    1175              2026-10-27  5548    1175
...                                   ...

Refreshable rollup by plan, tenant_daily_summary (13 ms):
plan        events  errorRate  worstP95LatencyMs
enterprise  26424   0.0244     3057
growth      5175    0.0230     2723
```

Same numbers, three sources. The rollups answer in a fraction of the time and the
smoke test proves they match hand-written SQL over the raw table exactly.

## Install

```bash
npx hypequery create materialized-view-rollups -y
cd materialized-view-rollups
docker compose -f ../examples/_seed/docker-compose.yml up -d --wait && pnpm seed   # or point env vars at your own ClickHouse
pnpm install
pnpm dev
```

`pnpm dev` runs `sql/*.sql` to create both rollups over the seed's `events`
table, waits for the first refresh, then prints the comparison above.

## What it shows

- **An incremental materialized view** (`sql/01-incremental.sql`): an INSERT trigger that writes aggregate states into an `AggregatingMergeTree`, backfilled with `INSERT … SELECT`, never `POPULATE`.
- **A refreshable materialized view** (`sql/02-refreshable.sql`): a full recompute every hour, with a `JOIN` to `tenants` and an exact p95, which an incremental view cannot do cheaply.
- **One dataset per target** (`src/datasets.ts`): `measure.merge('uniqExact', 'users')` finalizes the stored state, so distinct users stay exact whether you ask by day, week or month.
- **The same semantic query against raw and rolled-up data** (`src/query.ts`): identical results, with timings from `result.meta`.
- **A smoke test as ground truth** (`src/smoke.test.ts`): compares every rollup against raw SQL over all one million rows.

## Key file

`src/datasets.ts` defines three datasets over the same facts: the raw table, the
incremental target and the refreshable target. Only the source and the way
uniques are read differ.

```ts
export const EventsDaily = dataset('eventsDaily', {
  source: 'events_daily',
  timeKey: 'day',
  timeGrains: ['day', 'week', 'month', 'quarter', 'year'],
  dimensions: {
    day: dimension.timestamp(),
    tenantId: dimension.number({ column: 'tenant_id' }),
    eventType: dimension.string({ column: 'event_type' }),
  },
  measures: {
    events: measure.sum('events'),                      // SimpleAggregateFunction(sum)
    errors: measure.sum('errors'),
    uniqueUsers: measure.merge('uniqExact', 'users'),   // uniqExactMerge(users)
    errorRate: measure.derived({
      uses: { errors: 'errors', events: 'events' },
      formula: ({ errors, events }) => divide(errors, nullIfZero(events)),
    }),
  },
});
```

## Architecture

```text
events (1M rows, seed)
  ├─ events_daily_mv  ──INSERT trigger──▶  events_daily (AggregatingMergeTree, states)
  │                                           └─ dataset EventsDaily  ── measure.merge
  └─ tenant_daily_summary_rmv ──REFRESH EVERY 1 HOUR──▶ tenant_daily_summary (MergeTree, values)
       JOIN tenants                                       └─ dataset TenantDailySummary
```

`analytics.execute(dataset, { by: 'day', measures: [...] })` is the same call
for all three datasets. hypequery generates `sum(...)`, `uniqExactMerge(...)`
or `count()` as the source requires.

## Adapt it

- **Pick the view type by question.** Freshness in seconds and a single source table: incremental. Joins, exact percentiles, top-N or anything you want to recompute wholesale: refreshable. Many teams run both over the same facts, as here.
- **Watch the trigger fire.** Insert a row into `events` and the incremental target updates on the same insert; `tenant_daily_summary` changes only after `SYSTEM REFRESH VIEW tenant_daily_summary_rmv`. Clean up with `ALTER TABLE events DELETE WHERE event_id > 1000000` so the seed checksum still matches.
- **Approximate uniques are fine for most dashboards.** Swap `uniqExactState`/`uniqExact` for `uniqState`/`uniq` to shrink the target table; `measure.merge('uniq', 'users')` reads it and the catalog marks the measure approximate.
- **Scheduling.** `REFRESH EVERY 1 HOUR` can become `REFRESH EVERY 1 DAY OFFSET 2 HOUR`, or `REFRESH AFTER 10 MINUTE` for an interval since the last run. `DEPENDS ON` chains refreshable views.
- **Tenant scoping.** Add `tenantKey: 'tenant_id'` to any of the datasets to require a tenant in every query. See the multi-tenant example.

## Related recipes

- p95 latency (coming in this series)

## Related examples

- Next.js dashboard (coming in this series)

Tested on ClickHouse 25.8 with hypequery `@hypequery/datasets` 0.29 and `@hypequery/clickhouse` 2.14.
