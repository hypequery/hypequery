# Weekly retention cohorts in ClickHouse with a typed dataset

Turn signup cohorts and weekly activity into a retention dataset: cohort size, active users and retention ratio, sliceable by cohort and week offset.

## Demo

```text
Weekly retention, signup cohorts 2026-06-01 to 2026-06-30

cohort      size   w0    w1    w2    w3    w4    w5    w6
2026-06-01    93  55%   72%   59%   59%   58%   55%   55%
2026-06-08    88  69%   64%   59%   58%   56%   55%   51%
2026-06-15    91  67%   69%   68%   63%   62%   62%   56%
2026-06-22    72  63%   71%   56%   54%   50%   50%   50%
2026-06-29    94  65%   70%   61%   60%   62%   60%   52%
```

## Install

```bash
npx @hypequery/cli create retention-cohorts -y
cd retention-cohorts
docker compose -f ../examples/_seed/docker-compose.yml up -d --wait && pnpm seed   # or set CLICKHOUSE_* for your own ClickHouse
pnpm install
pnpm dev
```

`pnpm dev` creates the `user_cohort_activity` view, runs the query and prints the grid.

## What it shows

- **Shape the data once, in SQL** (`sql/cohort-activity.sql`): a view joins users to events, tags each active week with the user's signup cohort, and carries the cohort size via a window function.
- **Retention as a dataset** (`src/dataset.ts`): `countDistinct(userId)` for active users, `max(cohortSize)` to read the window value back, and a derived `retention = active / size`.
- **One query, the familiar grid** (`src/recipe.ts`): group by cohort week and weeks-since-signup, then a ten-line pivot for display.
- **Exactness** (`src/smoke.test.ts`): distinct counts are exact, so the captured `output.json` must match exactly, and a hand-written SQL query is the ground truth.

## Key file

```ts
export const query: DatasetQuery = {
  dimensions: ['cohortWeek', 'weeksSinceSignup'],
  measures: ['cohortSize', 'activeUsers', 'retention'],
  filters: [between('cohortWeek', '2026-06-01 00:00:00', '2026-06-30 23:59:59'), lte('weeksSinceSignup', 6)],
  orderBy: [{ field: 'cohortWeek', direction: 'asc' }, { field: 'weeksSinceSignup', direction: 'asc' }],
};
```

## Architecture

```text
users ──┐
        ├─ VIEW user_cohort_activity (cohort_week, cohort_size, user_id, weeks_since_signup)
events ─┘        │
                 └─ dataset CohortRetention ── activeUsers / cohortSize = retention
                          │
                 analytics.execute(CohortRetention, query) ──▶ 35 rows ──▶ toGrid() ──▶ 5 cohorts × 7 weeks
```

## Adapt it

- **Daily or monthly cohorts.** Change `toStartOfWeek` to `toDate` or `toStartOfMonth` in the view, and the `dateDiff` unit to match. The dataset and the query do not change.
- **Retention relative to first activity.** Replace `signed_up_at` in the view's cohort CTE with each user's first event (`min(occurred_at) OVER (PARTITION BY user_id)`).
- **Per tenant.** Add `tenant_id` to the view and `tenantKey: 'tenant_id'` to the dataset; every query is then scoped to one tenant.
- **Materialize it.** On large tables, turn the view into a table filled by a refreshable materialized view (see the refreshable guide) and point `source` at it.
- **Serve it.** Register the dataset with `@hypequery/serve` and the same query becomes a `useDataset('cohortRetention', …)` hook in React.

## Related recipes

- [p95-latency](../p95-latency): the same dataset pattern over raw events.

## Related examples

- [nextjs-dashboard](../nextjs-dashboard): where a retention grid would live.
- [materialized-view-rollups](../materialized-view-rollups): make the view a refreshable table.

Versions used: ClickHouse 25.8, `@hypequery/datasets` 0.29 and `@hypequery/clickhouse` 2.14.
