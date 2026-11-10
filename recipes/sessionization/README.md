# Sessionization in ClickHouse with lagInFrame and a typed dataset

Split events into 30-minute inactivity sessions per user with lagInFrame and a running sum, then count sessions and average their length with a dataset.

To sessionize in ClickHouse, read each event's previous timestamp with `lagInFrame(occurred_at) OVER (PARTITION BY user_id ORDER BY occurred_at)`, flag the events whose gap is over 1,800 seconds, and number sessions with a running `sum()` of that flag over the same window; `GROUP BY user_id, session_number` then gives one row per session. On the seed's last week (2026-10-25 to 2026-10-31) that is 26,262 sessions by 1,705 users, 195 seconds and 1.23 events per session on average. The recipe keeps that SQL in a view and puts a hypequery dataset on top for the counts and averages.

## Demo

```text
Sessions per day (30-minute timeout), 2026-10-25 to 2026-10-31

day          sessions  users  per user  avg length (s)  avg events
2026-10-25       1955    798      2.45            84.1        1.10
2026-10-26       4413   1186      3.72           210.1        1.26
2026-10-27       4466   1175      3.80           207.1        1.24
2026-10-28       4415   1177      3.75           203.6        1.24
2026-10-29       4579   1191      3.84           218.1        1.26
2026-10-30       4418   1193      3.70           229.8        1.27
2026-10-31       2016    845      2.39           100.6        1.11

whole week      26262   1705     15.40           195.4        1.23
```

The 25th and the 31st are a Sunday and a Saturday, when the seed's traffic dips. The seed is sparse per user, so 84.3% of the week's sessions are a single event (length 0); the longest runs 19,194 seconds.

## Install

```bash
npx hypequery create sessionization -y
cd sessionization
docker compose -f ../examples/_seed/docker-compose.yml up -d --wait && pnpm seed   # or set CLICKHOUSE_* for your own ClickHouse
pnpm install
pnpm dev
```

`pnpm dev` creates the `sessionization_sessions` view, runs the query, and prints the daily table, the week and the timeout comparison.

## What it shows

- **Sessions in two window passes** (`sql/sessions.sql`): `lagInFrame` for the previous event time, then `sum(gap > 1800) OVER (...)` as a running session number, then `GROUP BY` to one row per session with start, end, length and event count.
- **Sessions as a dataset** (`src/dataset.ts`): `count` sessions, `countDistinct` users, `avg` length and events, and a derived sessions-per-user, all with `session_start` as the time key so `by: 'day'` works.
- **The generated SQL is asserted** (`expected.sql`): hypequery buckets with `toStartOfDay` and parameterises the range.
- **Checked against arrays** (`src/smoke.test.ts`): the test rebuilds every session with `groupArray`, `arrayDifference` and `arraySplit`, with no window functions, and the daily counts and averages must match.
- **The timeout matters** (`compareTimeouts()` in `src/recipe.ts`): the same week with 15, 30 and 60 minutes, pinned.

## Key file

```ts
export const query = {
  by: 'day',
  measures: ['sessions', 'users', 'sessionsPerUser', 'avgDurationSeconds', 'avgEventsPerSession'],
  filters: [between('sessionStart', '2026-10-25 00:00:00', '2026-10-31 23:59:59')],
} satisfies DatasetQueryFor<typeof Sessions>;

const result = await analytics.execute(Sessions, query);
```

The view at the heart of it:

```sql
lagInFrame(occurred_at, 1, toDateTime(0, 'UTC')) OVER w AS previous_at
...
sum(toUInt32(dateDiff('second', previous_at, occurred_at) > 1800)) OVER w AS session_number
...
WINDOW w AS (PARTITION BY tenant_id, user_id ORDER BY occurred_at, event_id
             ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW)
```

## The timeout is the definition

| Timeout | Sessions | Average length (s) |
| ---: | ---: | ---: |
| 15 min | 29,033 | 49.7 |
| 30 min | 26,262 | 195.4 |
| 60 min | 22,122 | 727.6 |

Doubling the timeout from 30 to 60 minutes cuts the session count by 16% and almost quadruples the average length, on the same events. Pick the timeout once, in the view, and every dashboard inherits it.

## lagInFrame details that bite

- **The first event.** It has no previous row, so `lagInFrame` returns the default: `1970-01-01 00:00:00` for a `DateTime` (also without the third argument). The gap is then decades and the first event always opens session 1.
- **The frame.** `lagInFrame` and `leadInFrame` only see rows inside the window frame, not the whole partition. The default frame ends at the current row, so lag works, but `leadInFrame` under the default frame returns the default value for almost every row (only same-timestamp peers see each other). Spell out the `ROWS` frame, with `UNBOUNDED FOLLOWING` for lead.
- **Ties.** Add a unique column to `ORDER BY` (`event_id` here) so same-second events have a stable order.
- **Cost.** The view re-sessionizes the whole table on every query: the date filter applies after the window functions, so the query reads all 1,000,000 rows (about 0.4 s on a laptop). Beyond a few hundred million events, materialize sessions into a table on a schedule.

## Architecture

```text
events ── VIEW sessionization_sessions
            lagInFrame → gap > 30 min → running sum = session_number → GROUP BY session
                 │
                 └─ dataset sessions ── sessions, users, avgDurationSeconds, avgEventsPerSession
                          │
                 analytics.execute(Sessions, { by: 'day', ... }) ──▶ output.json (asserted in CI)
```

## Adapt it

- **Another timeout.** Change `1800` in the view. The dataset and the query do not change.
- **Without window functions.** `arraySplit((t, gap) -> gap > 1800, ts, arrayDifference(...))` over `arraySort(groupArray(occurred_at))` per user gives the same sessions (that is the test's ground truth). It holds each user's events in memory at once, so it suits bounded ranges.
- **Per tenant.** Add `dimensions: ['tenantId']`, or set `tenantKey: 'tenant_id'` on the dataset to scope every query to one tenant.
- **Sessions with errors.** `error_count` is already in the view; add a measure such as `measure.count('userId', { filters: [gt('errorCount', 0)] })`.
- **Materialize it.** Point a refreshable materialized view at the same SELECT and the dataset's `source` at its target table (see the materialized view example).

## Related recipes

- [funnel-windowfunnel](../funnel-windowfunnel): a different cut of the same event stream, ordered steps instead of sessions.
- [retention-cohorts](../retention-cohorts): the same "shape it in a view, count it in a dataset" pattern.

## Related examples

- [materialized-view-rollups](../../examples/materialized-view-rollups): turn the view into a refreshed table.

Tested on ClickHouse 25.8 with `@hypequery/datasets` 0.29 and `@hypequery/clickhouse` 2.14.
