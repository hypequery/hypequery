# Refreshable materialized views in ClickHouse: schedule, refresh, monitor and query them

Create a refreshable materialized view on a schedule, refresh it on demand, watch it in system.view_refreshes, and query it through a typed hypequery dataset.

A refreshable materialized view re-runs its entire `SELECT` on a schedule and atomically replaces the contents of a target table. It is the ClickHouse answer to PostgreSQL's `REFRESH MATERIALIZED VIEW`, with the scheduler built in. It is the other kind of materialized view: an ordinary (incremental) one fires on every insert and only ever sees new rows, which makes `JOIN`s, exact percentiles and top-N painful. A refreshable view sees the whole table every time, at the price of being stale between runs.

Refreshable views have been generally available, with no feature flag, since ClickHouse 24.10. Everything below runs on ClickHouse 25.8 against the seed dataset's `events` and `tenants` tables (one million events, 200 tenants), and CI re-runs it on every change.

## When to reach for one

| Need | Incremental view | Refreshable view |
| --- | --- | --- |
| Freshness in seconds | Yes | No, stale until the next run |
| A `JOIN` whose right side changes | Snapshot at insert time only | Recomputed each run |
| Exact percentiles, medians, top-N | Not mergeable, so no | Plain SQL |
| Cost per insert | Adds latency to every insert | None |
| Cost per run | None | A full query, every interval |
| Backfill | Separate `INSERT ... SELECT` | The first run is the backfill |

If the question is "how many events per minute right now", use an incremental view. If it is "a daily table per tenant with the tenant's plan and an exact p95", use a refreshable one. Many teams run both over the same facts; the [materialized view rollups example](/examples/materialized-view-rollups) does exactly that.

## Create one

Create the target table yourself and point the view at it with `TO`. You then own the engine, `ORDER BY`, partitioning and TTL, and dropping the view later leaves the data in place.

{{sql:sql/01-create.sql}}

`REFRESH EVERY 1 HOUR` runs on the wall clock, at the top of each hour. `REFRESH AFTER 1 HOUR` would instead wait an hour after each run finishes. The first refresh starts as soon as the view is created, so the target is populated within one query's time; there is no `POPULATE` to worry about.

Each run writes into a fresh hidden table and swaps it in when the query completes, so readers never see a half-built result. If the query fails, the previous contents stay.

## Refresh on demand and wait for it

Deploy scripts and tests do not want to wait for the clock.

{{sql:sql/02-refresh-and-wait.sql}}

`SYSTEM REFRESH VIEW` starts a run immediately (and cancels the schedule's next tick for this interval). `SYSTEM WAIT VIEW` blocks until the current run finishes, and fails if it failed, which is what makes it useful in CI. There is also `SYSTEM STOP VIEW` / `SYSTEM START VIEW` to pause and resume scheduling, and `SYSTEM CANCEL VIEW` to abort a run.

## Monitor it

Every refreshable view reports its state in `system.view_refreshes`.

{{sql:sql/03-monitor.sql}}

The columns worth alerting on:

- `status`: `Scheduled`, `Running`, `WaitingForDependencies`, `Disabled`, or an error state.
- `exception` and `retry`: the last failure and how many retries the scheduler has attempted. By default a failed run is retried with backoff until it succeeds.
- `last_success_time` and `next_refresh_time`: if the gap between them keeps growing, the query takes longer than the interval.
- `last_success_duration_ms`: track it; a run that takes longer than its interval will simply start late, but it is a sign the table or the query has outgrown the schedule.

## Chain views with DEPENDS ON

A view that reads another refreshable view's target should wait for that view to finish, or it will sometimes read the previous run's data.

{{sql:sql/04-depends-on.sql}}

`DEPENDS ON` only works with `REFRESH EVERY`, not `REFRESH AFTER`. A dependent view with the same interval runs once its dependencies have completed their run for that interval; this is how teams build small DAGs without an orchestrator.

## Keep history with APPEND

By default each run replaces the whole target. `APPEND` inserts the run's rows instead, which turns a refreshable view into a snapshot writer.

{{sql:sql/05-append-mode.sql}}

Pair `APPEND` with a `TTL` or a partition key you can drop, because nothing else ever deletes from the target. `RANDOMIZE FOR` adds jitter to the schedule so that many views do not all start at the same second.

## Change the schedule, drop the view

The schedule is part of the view's definition and can be changed in place.

{{sql:sql/06-modify-and-drop.sql}}

Two constraints to know before you design around them: `DEPENDS ON` must be restated in the `MODIFY REFRESH` clause or it is dropped, and `APPEND` cannot be added to or removed from an existing view; recreate the view for that. Dropping a refreshable view never touches its target table.

## Query it from TypeScript

The target is an ordinary table, so any client can read it. With [`@hypequery/datasets`](/docs/datasets/overview) a dataset over the target gives dashboards, APIs and agents one definition of what the columns mean:

```typescript
import { dataset, dimension, divide, measure, nullIfZero } from '@hypequery/datasets';

export const TenantDailySummary = dataset('tenantDailySummary', {
  source: 'tenant_daily_summary',
  timeKey: 'day',
  timeGrains: ['day', 'week', 'month', 'quarter', 'year'],
  dimensions: {
    day: dimension.timestamp(),
    tenantId: dimension.number({ column: 'tenant_id' }),
    tenantName: dimension.string({ column: 'tenant_name' }),
    plan: dimension.string(),
  },
  measures: {
    events: measure.sum('events'),
    errors: measure.sum('errors'),
    worstP95LatencyMs: measure.max('p95_latency_ms', { label: 'Worst daily p95 latency (ms)' }),
    errorRate: measure.derived({
      uses: { errors: 'errors', events: 'events' },
      formula: ({ errors, events }) => divide(errors, nullIfZero(events)),
    }),
  },
});
```

```typescript
const byPlan = await analytics.execute(TenantDailySummary, {
  dimensions: ['plan'],
  measures: ['events', 'errorRate', 'worstP95LatencyMs'],
  filters: [between('day', '2026-10-25', '2026-10-31')],
  orderBy: [{ field: 'events', direction: 'desc' }],
});
```

Because the target holds final values rather than aggregate states, the measures are plain `sum` and `max`. Note what is deliberately missing: a `sum` over `unique_users` would be wrong at any grain other than tenant-day, so the dataset does not publish it. If you need uniques that roll up, store `uniqExactState(user_id)` in the target and read it with `measure.merge('uniqExact', ...)`, as the incremental half of the [rollups example](/examples/materialized-view-rollups) does.

```bash
npx hypequery create materialized-view-rollups -y
```

## Pitfalls

- **The query outgrows the interval.** Watch `last_success_duration_ms`. Partition the target and move to incremental views for the hot part of the data before runs start overlapping.
- **Memory.** A refreshable view is a full query; `max_memory_usage` and `max_bytes_before_external_group_by` apply. Run it manually once and read `system.query_log` before scheduling it.
- **Staleness is a product decision.** Put `last_success_time` on the dashboard that reads the table, or expose it from your API, so users know how old the numbers are.
- **Replicated setups.** On a cluster, only one replica runs each refresh; `last_refresh_replica` says which. Use `Replicated` target tables so every replica serves the result.
- **Dropping the dependency.** Dropping a view that others `DEPENDS ON` leaves them waiting forever (`WaitingForDependencies`). Modify the dependents first.

## FAQ

### What is a refreshable materialized view in ClickHouse?

A materialized view with a `REFRESH` clause. Instead of firing on inserts, it re-runs its whole `SELECT` on a schedule (`EVERY` on the clock, `AFTER` relative to the last run) and atomically replaces, or with `APPEND` adds to, a target table.

### How do I refresh a materialized view manually?

`SYSTEM REFRESH VIEW <name>` starts a run now; `SYSTEM WAIT VIEW <name>` blocks until it finishes. Incremental (non-refreshable) views cannot be refreshed; backfill them with `INSERT ... SELECT`.

### How do I see when a refreshable view last ran?

`SELECT view, status, last_success_time, next_refresh_time, exception FROM system.view_refreshes`.

### Can a refreshable materialized view use a JOIN?

Yes, and this is the main reason to use one. The whole query runs each time, so the right side of the join is read fresh, unlike an incremental view that snapshots it at insert time.

### Which ClickHouse version do I need?

Refreshable materialized views are production-ready without flags from 24.10. This guide was tested on 25.8.

## Related

- [A guide to materialized views in ClickHouse](/blog/a-guide-to-materialized-views-in-clickhouse): the pillar on incremental views, engines, backfills and pitfalls.
- [Materialized view rollups example](/examples/materialized-view-rollups): incremental and refreshable side by side, with a smoke test.
- Function pages: [`toStartOfDay`](/clickhouse/functions/to-start-of-day), [`quantile`](/clickhouse/functions/quantile), [`count`](/clickhouse/functions/count).
