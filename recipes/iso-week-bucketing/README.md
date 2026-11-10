# ISO weeks in ClickHouse: toMonday buckets and %G-W%V labels across the year boundary

Bucket events into Monday-to-Sunday ISO weeks with labels like 2026-W01, and see where toStartOfWeek, %Y and toWeek go wrong at new year.

**The short answer:** bucket with `toMonday(ts)` (or `toStartOfWeek(ts, 1)`, the same thing) and label with `formatDateTime(ts, '%G-W%V')`. `%G` is the ISO year and `%V` the ISO week number. Do not use `%Y` with `%V`, and do not rely on the default mode of `toStartOfWeek`, `toWeek` or `toYearWeek`: mode 0 means weeks start on Sunday.

## Demo

```text
Events per ISO week, 2025-12-15 to 2026-01-18

isoWeek   isoWeekStart  events  activeUsers  firstEventAt         lastEventAt
2025-W51  2025-12-15     11929          809  2025-12-15 00:03:42  2025-12-21 23:54:04
2025-W52  2025-12-22     12055          828  2025-12-22 00:02:03  2025-12-28 23:48:21
2026-W01  2025-12-29     12420          838  2025-12-29 00:01:59  2026-01-04 23:58:01
2026-W02  2026-01-05     12924          847  2026-01-05 00:00:19  2026-01-11 23:57:26
2026-W03  2026-01-12     13011          865  2026-01-12 00:01:09  2026-01-18 23:59:51
```

ISO week 1 of 2026 starts on Monday 29 December 2025: the first and last event of the `2026-W01` bucket fall in two calendar years.

## Install

```bash
npx @hypequery/cli create iso-week-bucketing -y
cd iso-week-bucketing
docker compose -f ../examples/_seed/docker-compose.yml up -d --wait && pnpm seed   # or set CLICKHOUSE_* for your own ClickHouse
pnpm install
pnpm dev
```

## What it shows

- **Two dimensions for one week** (`src/dataset.ts`): `isoWeekStart` is the Monday as a `Date`, for sorting and time axes; `isoWeek` is the `%G-W%V` label for tables and exports. Grouping by both costs nothing, because one determines the other.
- **One semantic query** (`src/recipe.ts`): events, active users, and the first and last event per week, so the output proves each bucket runs Monday 00:00 to Sunday 23:59.
- **The generated SQL is asserted** (`expected.sql`), and `output.json` must match exactly: counts, distinct counts and min/max are exact.
- **Four pitfalls pinned on the seed** (`src/smoke.test.ts`), each a failing assertion if ClickHouse ever changes behaviour.

## Key file

```ts
export const Events = dataset('events', {
  source: 'events',
  timeKey: 'occurred_at',
  dimensions: {
    eventId: dimension.number({ column: 'event_id' }),
    userId: dimension.number({ column: 'user_id' }),
    occurredAt: dimension.timestamp({ column: 'occurred_at' }),
    isoWeekStart: dimension.timestamp({ sql: 'toMonday(occurred_at)', dependencies: ['occurred_at'] }),
    isoWeek: dimension.string({ sql: "formatDateTime(occurred_at, '%G-W%V')", dependencies: ['occurred_at'] }),
  },
  measures: {
    events: measure.count('eventId'),
    activeUsers: measure.countDistinct('userId'),
    firstEventAt: measure.min('occurredAt'),
    lastEventAt: measure.max('occurredAt'),
  },
});
```

## The pitfalls, with seed numbers

| Pitfall | What happens on the seed |
| --- | --- |
| `formatDateTime(ts, '%Y-W%V')` | Monday 29 to Wednesday 31 December 2025 are labelled `2025-W01` (6,418 events), Thursday 1 to Sunday 4 January `2026-W01` (6,002). One ISO week, two labels, and `2025-W01` sorts as if it were January 2025. `%G-W%V` gives `2026-W01` for all 12,420. |
| `toStartOfWeek(ts)` with no mode | Mode 0: weeks start on **Sunday**. The five ISO weeks above become six buckets starting 2025-12-14, and the last one (2026-01-18) holds a single day, 895 events. The dataset's built-in `by: 'week'` grain renders exactly this, so use the ISO dimensions when you want Monday weeks. |
| A week number without its year | `toISOWeek(ts) = 44` matches both 2025-W44 (1,452 events, the seed's first partial week) and 2026-W44 (30,190). Group by the label or by the Monday, never by the bare number. |
| `toWeek` and `toYearWeek` defaults | Both default to mode 0. For 2026-01-01, `toWeek` returns 0 and `toYearWeek` returns 202552; with mode 3 (ISO) they return 1 and 202601. `toISOWeek` is mode 3 without the argument. |

Two more, verified on 25.8 but not on the seed's data: `formatDateTime` does not implement the MySQL week specifiers `%U` and `%x`; both throw `NOT_IMPLEMENTED`. And the first and last weeks of any range are usually partial: the seed starts on Saturday 2025-11-01, so its first ISO week has two days of data.

## Week functions at a glance

Run on ClickHouse 25.8 for Thursday 2026-01-01:

| Expression | Result | Week starts | Year |
| --- | --- | --- | --- |
| `toStartOfWeek(d)` | 2025-12-28 | Sunday | n/a |
| `toStartOfWeek(d, 1)`, `toMonday(d)` | 2025-12-29 | Monday | n/a |
| `formatDateTime(d, '%G-W%V')` | `2026-W01` | Monday | ISO year |
| `formatDateTime(d, '%Y-W%V')` | `2026-W01` here, but `2025-W01` for 2025-12-29 | Monday | calendar year (wrong) |
| `toYearWeek(d, 3)` | 202601 | Monday | ISO year |
| `toISOYear(d)`, `toISOWeek(d)` | 2026, 1 | Monday | ISO year |

## Architecture

```text
events.occurred_at ──▶ toMonday()                  isoWeekStart (Date, sortable)
                  └──▶ formatDateTime('%G-W%V')    isoWeek      (String, display)
                             │
src/recipe.ts   analytics.toSQL(Events, query)   ──▶ expected.sql  (asserted in CI)
                analytics.execute(Events, query) ──▶ output.json   (asserted exactly in CI)
```

## Adapt it

- **Time zones.** `toMonday(occurred_at)` uses the column's time zone, UTC here. For weeks in a user's zone pass it explicitly: `toMonday(occurred_at, 'Europe/Berlin')` and `formatDateTime(occurred_at, '%G-W%V', 'Europe/Berlin')`. See [DateTime vs DateTime64 and time zones](/blog/clickhouse-datetime-vs-datetime64-time-zones).
- **Sunday weeks on purpose.** US retail calendars often start on Sunday; then `toStartOfWeek(ts)` (mode 0) or the dataset's `by: 'week'` is right, and the label should be the start date, not `%V`.
- **Numeric keys.** `toYearWeek(ts, 3)` gives `202601`, an integer that sorts correctly and is cheap to store in a rollup table's `ORDER BY`.
- **Fill empty weeks.** `ORDER BY isoWeekStart WITH FILL STEP toIntervalWeek(1)` in raw SQL emits zero rows for weeks with no events.

## Related recipes

- [retention-cohorts](../retention-cohorts): weekly cohorts built on `toStartOfWeek(signed_up_at, 1)`.
- [p95-latency](../p95-latency): the same dataset pattern with percentile measures.

## Related examples

- [nextjs-dashboard](../nextjs-dashboard): where a weekly chart would live.

Tested on ClickHouse 25.8 with `@hypequery/datasets` 0.29 and `@hypequery/clickhouse` 2.14.
