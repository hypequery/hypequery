# Cursor pagination in ClickHouse: keyset vs LIMIT/OFFSET, measured

Page a tenant's events newest first with a keyset cursor on (occurred_at, event_id) and see from EXPLAIN and query_log why it beats OFFSET on deep pages.

For cursor pagination in ClickHouse, order by a unique key that follows the table's sort key, `ORDER BY occurred_at DESC, event_id DESC`, and fetch the next page with `WHERE occurred_at < :t OR (occurred_at = :t AND event_id < :id)`, where `:t, :id` is the last row of the previous page. On the seed, page 1,001 of one tenant read about 6,000 to 9,000 rows that way and about 105,000 rows with `OFFSET 50000`, the tenant's whole history. Write the condition as the expanded `OR`, not as the tuple `(occurred_at, event_id) < (:t, :id)`: on ClickHouse 25.8 the tuple form is not used by partition pruning or the primary key. Longer background: [How to paginate ClickHouse results in TypeScript](https://hypequery.com/blog/clickhouse-pagination-typescript).

## Demo

```text
Tenant 47, newest first, 50 per page

page 1   825213  2026-10-31 23:58:36  api_call   /api/v1/datasets
         777014  2026-10-31 23:44:38  page_view  /dashboard
         ...
         499194  2026-10-31 16:49:06  login      /login        <- cursor
page 2   196645  2026-10-31 16:46:30  page_view  /explore
         635639  2026-10-31 16:44:31  api_call   /api/v1/query
         ...
         508131  2026-10-31 12:14:23  api_call   /api/v1/users <- next cursor

OFFSET vs keyset, 50 rows a page

page   offset    granules after the primary key    rows read (query_log)
                 OFFSET      keyset                OFFSET     keyset
   1        0       106         106                9-12k      9k
  21    1,000       106         105                27k        9-12k
 201   10,000       106          96                89-104k    9-12k
1001   50,000       106          54                105k       6-9k
```

Granule counts come from `EXPLAIN indexes = 1` and are pinned by the test. Rows read come from `system.query_log` and move by a granule or two between runs with `max_threads` (8 cores here), so the test asserts their shape, not exact values.

## Install

```bash
npx @hypequery/cli create cursor-pagination -y
cd cursor-pagination
docker compose -f ../examples/_seed/docker-compose.yml up -d --wait && pnpm seed   # or set CLICKHOUSE_* for your own ClickHouse
pnpm install
pnpm dev
```

`pnpm dev` prints the first two pages, then builds `cursor_pagination_events` (a compacted copy of `events`, see below), prints the cost table and drops the copy again.

## What it shows

- **A keyset page with the typed query builder** (`src/pagination.ts`): `whereGroup` / `orWhereGroup` build the `OR` condition, and the cursor is an opaque base64url string of `{ occurredAt, eventId }`.
- **The generated SQL is asserted** (`expected.sql`): page 2's statement, with the cursor bound as parameters.
- **The first two pages are pinned** (`output.json`), and the test walks five pages both ways to prove keyset and OFFSET return the same rows.
- **Ties are handled**: tenant 47 has three events at 2026-10-30 14:03:47; a cursor on `occurred_at` alone skips the rest of that second, the `(occurred_at, event_id)` cursor does not. The test checks both.
- **Cost, measured** (`src/cost.ts`): granules from `EXPLAIN indexes = 1`, rows read from `system.query_log` by `queryId`.

## Key file

```ts
export function keysetPageQuery(tenantId: number, pageSize: number, after: Cursor | null) {
  let query = db.table('events')
    .select(['event_id', 'occurred_at', 'event_type', 'user_id', 'path'])
    .where('tenant_id', 'eq', tenantId);
  if (after) {
    query = query.whereGroup((q) => {
      q.where('occurred_at', 'lt', after.occurredAt).orWhereGroup((tie) => {
        tie.where('occurred_at', 'eq', after.occurredAt).where('event_id', 'lt', after.eventId);
      });
    });
  }
  return query.orderBy('occurred_at', 'DESC').orderBy('event_id', 'DESC').limit(pageSize);
}
```

## Why keyset wins, and when it does not

- **OFFSET reads what it skips.** `LIMIT 50 OFFSET 50000` has to produce 50,050 rows in order before it can drop 50,000. Already at `OFFSET 10000` the server read 89,000 to 104,000 rows, close to all of the tenant's 97,376.
- **Keyset skips with the index.** The cursor condition is a range on the sort key `(tenant_id, occurred_at, event_id)`, so partition pruning drops months after the cursor, the primary key narrows the granules (54 of 977 on page 1,001), and the plan reads in reverse sort-key order (`ReadType: InReverseOrder` in `EXPLAIN actions = 1`), so it stops once it has 50 rows.
- **The tuple trap.** `(occurred_at, event_id) < ('2026-07-09 18:05:48', 735428)` leaves 106 of 977 granules (only `tenant_id` is used, all 12 parts scanned); the expanded `OR` leaves 54 of 620 after pruning 3 parts. Same rows, different plan.
- **The sort key decides.** Keyset is fast here because `tenant_id` comes first in `ORDER BY`. The same cursor across all tenants gets partition pruning but almost nothing from the primary key (583 of the remaining 620 granules kept), because `occurred_at` is not a prefix of it. Give such a feed its own table or projection ordered by `(occurred_at, event_id)`.
- **What you give up.** No "jump to page 47" and no total page count for free. For a feed or an API that is usually fine; for a small admin table OFFSET is simpler and cheap.

### Why a copy for the measurements

The seed's `events` table holds a million rows in about 60 small parts with 8,192-row granules, and background merges change that layout over time. One granule then covers a large share of a tenant's month, so skipping barely shows, and the numbers drift. `src/cost.ts` copies the same rows into `cursor_pagination_events` with the same sort key, 1,024-row granules and one part per month (`OPTIMIZE ... FINAL`), so the comparison is stable. The pages themselves are read from `events`.

## Architecture

```text
client ── GET /events?cursor=<base64url>
             │
src/pagination.ts  keysetPage(tenant, 50, cursor)
             │       WHERE tenant_id = ? AND (occurred_at < ? OR (occurred_at = ? AND event_id < ?))
             │       ORDER BY occurred_at DESC, event_id DESC LIMIT 50
             ▼
          { rows, nextCursor }   ──▶ output.json (pages 1 and 2, asserted in CI)
```

## Adapt it

- **Oldest first.** Flip both `DESC` to `ASC` and `lt` to `gt`.
- **Another sort.** The cursor must be the full `ORDER BY` plus a unique tie-breaker, in the same direction, and ideally a prefix-compatible slice of the table's sort key.
- **Filters.** Add `where` clauses freely; they do not change the cursor. Changing the sort or filters invalidates old cursors, so put a version or the filter hash in the cursor if clients keep them.
- **Serve it.** Return `{ rows, nextCursor }` from any handler; `@hypequery/serve` or the FastAPI example show the HTTP side.
- **Aggregated lists.** Dataset queries already page grouped results with `limit` / `offset` and report `meta.pagination.hasMore`; those results are small, so OFFSET is fine there.

## Related examples

- [multi-tenant-embedded-analytics](../../examples/multi-tenant-embedded-analytics): per-tenant APIs where a feed like this lives.
- [fastapi-analytics-api](../../examples/fastapi-analytics-api): the HTTP side in Python.

Versions used: ClickHouse 25.8, `@hypequery/clickhouse` 2.14.
