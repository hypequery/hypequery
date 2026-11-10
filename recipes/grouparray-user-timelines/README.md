# Ordered per-user event timelines in ClickHouse with groupArray, arraySort and groupArraySorted

Build each user's event timeline in time order. groupArray's order is not guaranteed; sorting (time, id, value) tuples or groupArraySorted fixes it.

**The short answer:** `groupArray(x)` adds values in whatever order rows reach it, which depends on parts, partitions and threads, not on your timestamp. To get a timeline, collect tuples and sort them: `arrayMap(e -> e.3, arraySort(groupArray((occurred_at, event_id, path))))`. Tuples sort element by element, so that orders by time, then by `event_id` for events in the same second. For only the first N, `groupArraySorted(N)((occurred_at, event_id, path))` keeps the N smallest without collecting the rest.

## Demo

```text
Ordered timelines for users 112, 113, 245 on 2026-10-29

user 112 (5 events): /billing → /billing → /dashboard → /api/v1/query → /api/v1/export
user 113 (5 events): /api/v1/users → /explore → /api/v1/datasets → /export → /dashboard
user 245 (7 events): /api/v1/events → /login → /settings → /reports → /team → /api/v1/events → /billing
```

Each row also carries `gapsSeconds` (seconds since the previous step, `[0, 4329, 5507, ...]` for user 245) and `firstThree` from `groupArraySorted(3)`.

## Install

```bash
npx @hypequery/cli create grouparray-user-timelines -y
cd grouparray-user-timelines
docker compose -f ../examples/_seed/docker-compose.yml up -d --wait && pnpm seed   # or set CLICKHOUSE_* for your own ClickHouse
pnpm install
pnpm dev
```

## What it shows

- **A sorted timeline per user** (`src/recipe.ts`): `arraySort` over `(occurred_at, event_id, path)` tuples, then `arrayMap` to keep the path. `arrayDifference` over the same sorted times gives the gap between steps.
- **`groupArraySorted(3)`** for the first three steps, the bounded alternative to sorting everything.
- **The scalar facts as a dataset** (`src/dataset.ts`): event count, first and last event time, and the first and last path via `argMin` / `argMax`. The test checks they agree with the timeline's first and last element.
- **The pitfalls pinned** (`src/smoke.test.ts`): on the seed, plain `groupArray(occurred_at)` is out of time order for thousands of the 5,033 active users, and the count changes between runs; the sorted version is never out of order.

## Key file

```ts
const SORTED = 'arraySort(groupArray((occurred_at, event_id, path)))';

export function timelines() {
  return db
    .table('events')
    .select([
      'user_id',
      rawAs<string[], 'paths'>(`arrayMap(e -> e.3, ${SORTED})`, 'paths'),
      rawAs<number[], 'gapsSeconds'>(`arrayMap(d -> toInt32(d), arrayDifference(arrayMap(e -> e.1, ${SORTED})))`, 'gapsSeconds'),
      rawAs<string[], 'firstThree'>('arrayMap(e -> e.3, groupArraySorted(3)((occurred_at, event_id, path)))', 'firstThree'),
      rawAs<string, 'events'>('count()', 'events'),
    ])
    .where('user_id', 'in', USERS)
    .where('occurred_at', 'between', DAY)
    .groupBy('user_id')
    .orderBy('user_id', 'ASC');
}
```

## Ways to order a groupArray

| Approach | Ordered? | Notes |
| --- | --- | --- |
| `groupArray(path)` | No | Order is indeterminate. On the seed most users come back out of time order. |
| `groupArray(path)` over a subquery with `ORDER BY` | Not guaranteed | It came back sorted in every run on the seed, but ClickHouse does not promise it; parallel reads or a future optimisation can change it. |
| `arraySort(groupArray((ts, id, path)))` | Yes | Sorts the tuples; `e.3` picks the path back out. |
| `arraySort(x -> x.1, groupArray((ts, id, path)))` | Yes, by `ts` only | Same-second events keep an arbitrary relative order. |
| `groupArraySorted(N)((ts, id, path))` | Yes, ascending | Only the N smallest; memory bounded by N. |
| `arraySlice(arrayReverseSort(groupArray(...)), 1, N)` | Yes, newest first | The latest N; collects everything first. |

## Pitfalls

- **`groupArray(N)` is not "the first N".** `groupArray(3)(x)` stops after any three values. On the seed it differs from `groupArraySorted(3)` for thousands of users.
- **Same-second events.** The seed has 57 (user, second) pairs with two events, across 51 users. Sorting by time alone leaves their order to chance; put a unique column second in the tuple.
- **Parallel arrays.** Two separate `groupArray` calls (`groupArray(ts)`, `groupArray(path)`) then `arraySort((p, t) -> t, paths, times)` relies on the two arrays being built in step. One array of tuples cannot drift.
- **Memory.** `groupArray` holds every value for every group in memory. A timeline per user over a year is fine at seed scale; at billions of rows filter the time range first, cap with `groupArraySorted(N)`, or use `groupArray(max_size)` when any N values will do.
- **Int64 in JSON.** `arrayDifference` returns `Array(Int64)`, which the HTTP JSON formats quote as strings by default. The recipe narrows to `Int32` to get numbers.
- **The builder and raw aggregates.** When you add a helper aggregation such as `.count()`, hypequery infers `GROUP BY` from selections it does not recognise as aggregates, and `arrayMap(... groupArray ...)` is one of those. Keep the aggregate raw (`rawAs('count()', 'events')`) and call `.groupBy()` yourself, as the key file does.

## Architecture

```text
events ──WHERE user, day──▶ groupArray((occurred_at, event_id, path))   one tuple per event, any order
                                    │ arraySort                          time order, event_id breaks ties
                                    ├─▶ arrayMap(e -> e.3)              paths
                                    └─▶ arrayDifference(e.1)            gapsSeconds
src/recipe.ts   timelines().toSQL()   ──▶ expected.sql  (asserted in CI)
                timelines().execute() ──▶ output.json   (asserted exactly in CI)
src/dataset.ts  argMin/argMax(path, occurred_at) ──▶ must equal paths[0] and paths[-1]
```

## Adapt it

- **Sessions.** Split a timeline where the gap exceeds 30 minutes: `arraySplit((e, g) -> g > 1800, sorted, gaps)` gives one array per session.
- **Funnels.** For "did the user go /login then /explore then /export", `windowFunnel` or `sequenceMatch` answer it directly without building the array.
- **Paths as strings.** `arrayStringConcat(paths, ' > ')` for a readable journey column, or `count()` grouped by it to find the most common journeys.
- **Several fields.** Keep the whole tuple (`arraySort(groupArray((occurred_at, event_id, event_type, path)))`) and pick fields with `e.3`, `e.4`.

## Related recipes

- [top-n-per-group-limit-by](../top-n-per-group-limit-by): top N rows per group with `LIMIT BY`.
- [retention-cohorts](../retention-cohorts): per-user activity rolled up into cohorts.

## Related examples

- [nextjs-dashboard](../nextjs-dashboard): where a user journey view would live.

Tested on ClickHouse 25.8 with `@hypequery/clickhouse` 2.14 and `@hypequery/datasets` 0.29.
