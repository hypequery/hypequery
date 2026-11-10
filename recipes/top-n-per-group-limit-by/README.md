# Top N per group in ClickHouse with LIMIT BY, compared with row_number() and rank()

Get the top 3 paths for every tenant in one query with LIMIT 3 BY, typed in TypeScript, and see how ties change the answer under rank() and dense_rank().

**The short answer:** `ORDER BY tenant_id, events DESC, path LIMIT 3 BY tenant_id`. `LIMIT n BY expr` keeps the first `n` rows for each distinct value of `expr`, in `ORDER BY` order, so the `ORDER BY` is your ranking. Add a tiebreak column to it, or which tied rows survive is not defined. In hypequery it is `.limitBy(3, 'tenant_id')` on the query builder.

## Demo

```text
Top 3 paths per tenant, 2026-10-01 to 2026-10-31

tenant_id  path        events
        1  /login           3
        1  /explore         2
        1  /export          2
        2  /explore        53
        2  /login          24
        2  /reports        24
        3  /explore       226
        3  /dashboard      79
        3  /billing        77
        4  /explore       288
        4  /settings       93
        4  /reports        84
        5  /explore       165
        5  /dashboard      80
        5  /login          75
```

Tenant 1 has `/explore`, `/export` and `/reports` tied on 2 events. `LIMIT 3 BY` keeps exactly three rows, and the `path` tiebreak decides that `/reports` is the one left out.

## Install

```bash
npx hypequery create top-n-per-group-limit-by -y
cd top-n-per-group-limit-by
docker compose -f ../examples/_seed/docker-compose.yml up -d --wait && pnpm seed   # or set CLICKHOUSE_* for your own ClickHouse
pnpm install
pnpm dev
```

## What it shows

- **LIMIT BY from the typed query builder** (`src/recipe.ts`): `.limitBy(3, 'tenant_id')` after the `orderBy` chain; column names and result types come from `src/schema.ts`.
- **The same answer as `row_number()`** (`src/smoke.test.ts`): `row_number() OVER (PARTITION BY tenant_id ORDER BY events DESC, path) <= 3` returns identical rows.
- **Ties, pinned**: `rank() <= 3` returns 4 rows for tenant 1, and `dense_rank() <= 3` returns all 10 of its paths plus 4 for tenant 2.
- **One tenant is a plain LIMIT** (`src/dataset.ts`): a tenant-scoped dashboard does not need LIMIT BY; the dataset query with `limit: 3` renders `ORDER BY ... LIMIT 3`.
- **The generated SQL is asserted** (`expected.sql`) and `output.json` must match exactly.

## Key file

```ts
export function topPathsPerTenant() {
  return db
    .table('events')
    .select(['tenant_id', 'path'])
    .count('event_id', 'events')
    .where('tenant_id', 'in', TENANTS)
    .where('occurred_at', 'between', RANGE)
    .groupBy(['tenant_id', 'path'])
    .orderBy('tenant_id', 'ASC')
    .orderBy('events', 'DESC')
    .orderBy('path', 'ASC')
    .limitBy(TOP_N, 'tenant_id');
}
```

Renders:

```sql
SELECT tenant_id, path, COUNT(event_id) AS events FROM events
WHERE tenant_id IN (1, 2, 3, 4, 5) AND occurred_at BETWEEN '2026-10-01 00:00:00' AND '2026-10-31 23:59:59'
GROUP BY tenant_id, path
ORDER BY tenant_id ASC, events DESC, path ASC
LIMIT 3 BY tenant_id
```

## LIMIT BY or a window function?

| You want | Use |
| --- | --- |
| Exactly N rows per group | `LIMIT N BY group`, or `row_number() ... <= N` |
| Every row tied with the Nth (can be more than N) | `rank() ... <= N` |
| The top N distinct values, with all their ties | `dense_rank() ... <= N` |
| The rank number in the output | a window function; LIMIT BY does not expose a position |
| Rows 2 and 3 of each group | `LIMIT 1, 2 BY group` (offset 1, then 2 rows) |

On 25.8, `QUALIFY` filters on a window function without a subquery: `... QUALIFY row_number() OVER (PARTITION BY tenant_id ORDER BY events DESC, path) <= 3`. The test uses it as the ground truth.

## Pitfalls

- **No tiebreak, no guarantee.** `ORDER BY tenant_id, events DESC LIMIT 3 BY tenant_id` is valid, but for tenant 1 any two of the three tied paths can come back. Add a unique column last in the `ORDER BY`.
- **`LIMIT BY` then `LIMIT`.** `LIMIT 3 BY tenant_id LIMIT 5` returns 5 rows in total, not 5 per tenant: the plain `LIMIT` applies after `LIMIT BY`. The test pins it.
- **`rank()` ignores your tiebreak** unless it is in the window's `ORDER BY`. With `ORDER BY events DESC` only, tied rows share a rank and all of them pass `<= 3`.
- **Group first, then limit.** `LIMIT BY` runs after `GROUP BY` and `ORDER BY`, so it ranks the aggregated rows. To keep the latest 3 raw events per user, order by `occurred_at DESC` without a `GROUP BY`.

## Architecture

```text
events ──GROUP BY tenant_id, path──▶ ORDER BY tenant, events DESC, path ──▶ LIMIT 3 BY tenant_id ──▶ 15 rows
                                       (the ranking)                         (the cut)
src/recipe.ts  topPathsPerTenant().toSQL()   ──▶ expected.sql  (asserted in CI)
               topPathsPerTenant().execute() ──▶ output.json   (asserted exactly in CI)
```

## Adapt it

- **Top N per day.** `groupBy(['day', 'path'])` with `rawAs('toDate(occurred_at)', 'day')` in the select, and `.limitBy(5, 'day')`.
- **Several group columns.** `.limitBy(3, ['tenant_id', 'event_type'])` keeps three rows per tenant and event type.
- **Latest N events per user.** No aggregation: `.select(['user_id', 'event_type', 'occurred_at']).orderBy('user_id').orderBy('occurred_at', 'DESC').limitBy(10, 'user_id')`.
- **Serve one tenant.** Use the dataset and its `limit`, scoped by `tenantKey`, behind `@hypequery/serve`; see the multi-tenant example.

## Related recipes

- [p95-latency](../p95-latency): a dataset over the same events.

## Related examples

- [multi-tenant-embedded-analytics](../multi-tenant-embedded-analytics): tenant-scoped datasets behind an API.

More on the clause itself: [ClickHouse LIMIT BY in TypeScript](/blog/clickhouse-limit-by-typescript).

Tested on ClickHouse 25.8 with `@hypequery/clickhouse` 2.14 and `@hypequery/datasets` 0.29.
