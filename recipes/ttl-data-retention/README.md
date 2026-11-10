# Per-plan data retention in ClickHouse with TTL and a typed dataset

Expire free-plan events after 30 days and starter events after 180 with TTL WHERE, clear a column with column TTL, and pin the result on any run date.

**Short answer:** a table TTL is a delete rule ClickHouse applies when it merges parts: `TTL toDate(occurred_at) + INTERVAL 30 DAY WHERE plan = 'free'` removes free-plan rows 30 days after their date, and several rules, each with its own `WHERE`, can share one table (checked on 25.8). A column TTL (`path String TTL toDate(occurred_at) + INTERVAL 7 DAY`) resets just that column to its default and keeps the row. Neither is a read filter: expired rows stay visible until a merge removes them, so after adding or changing a rule run `ALTER TABLE ... MATERIALIZE TTL` to apply it to existing parts. The hypequery dataset needs no change; it reads what is left.

## Demo

```text
TTL rules declared, not yet materialized

plan          events  eventsWithPath  oldestEvent
enterprise    855125          855125  2025-11-01 00:01:14
free            2063            2063  2025-11-01 15:18:19
growth        126853          126853  2025-11-01 00:11:30
starter        15959           15959  2025-11-01 03:26:36

After ALTER TABLE ... MATERIALIZE TTL

plan          events  eventsWithPath  oldestEvent
enterprise    855125           24632  2025-11-01 00:01:14
free             261              59  2026-10-03 06:10:03
growth        126853            4863  2025-11-01 00:11:30
starter        11259             636  2026-05-06 00:04:44
```

Free tenants keep 30 days, starter 180, growth and enterprise everything; every plan keeps request paths for 7 days. Both states are pinned in `states.json`, the second one in `output.json`.

## Install

```bash
npx @hypequery/cli create ttl-data-retention -y
cd ttl-data-retention
docker compose -f ../examples/_seed/docker-compose.yml up -d --wait && pnpm seed   # or set CLICKHOUSE_* for your own ClickHouse
pnpm install
pnpm dev        # creates ttl_data_retention_events, prints before and after MATERIALIZE TTL
pnpm teardown   # drops it
```

The table is a copy of the seed's `events` with each tenant's `plan` stamped on the row; the seed tables are only read.

## The SQL

What you would run in production:

```sql
ALTER TABLE events_with_plan
    MODIFY TTL
        toDate(occurred_at) + INTERVAL 30 DAY WHERE plan = 'free',
        toDate(occurred_at) + INTERVAL 180 DAY WHERE plan = 'starter';

ALTER TABLE events_with_plan
    MODIFY COLUMN path String TTL toDate(occurred_at) + INTERVAL 7 DAY;

-- Apply both to the parts that already exist. A mutation.
ALTER TABLE events_with_plan MATERIALIZE TTL SETTINGS mutations_sync = 1;
```

`sql/setup.sql` runs the same statements with two differences, both so the output is the same on every run:

- **The seed is frozen in time.** Its events end on 2026-10-31, but TTL is measured against the server clock. Each interval gets `+ INTERVAL {seed_age_days} DAY`, the days between 2026-11-01 and the server's `today()`, filled in by `src/setup.ts`. The cut-offs then always land on the same seed dates: free keeps 2026-10-03 onwards, starter 2026-05-06 onwards, paths 2026-10-26 onwards.
- **TTL is on `toDate(occurred_at)`, not the timestamp.** A `DateTime` TTL moves the cut-off every second; a `Date` one moves it once a day. The only remaining edge is a run that starts before midnight UTC and materializes after it.

Setup also runs `SYSTEM STOP MERGES` on the table and declares the rules with `materialize_ttl_after_modify = 0`, so nothing is removed until `MATERIALIZE TTL` and the "before" state is stable. Neither belongs in production.

## The dataset

`src/dataset.ts` is an events dataset with nothing TTL-specific in it. `eventsWithPath` is a filtered count (`measure.count('eventId', { filters: [neq('path', '')] })`), which is how the column TTL shows up:

```ts
export const query = {
  dimensions: ['plan'],
  measures: ['events', 'eventsWithPath', 'oldestEvent', 'newestEvent'],
  orderBy: [{ field: 'plan', direction: 'asc' }],
} satisfies DatasetQueryFor<typeof Events>;
```

The smoke test checks the retained rows against the same policy applied by hand to the seed `events` and `tenants`.

## Trade-offs and pitfalls (checked on 25.8)

- **Expired is not deleted.** With TTL merges stopped, an insert already past its TTL was stored and counted. In a fresh table a `TTLDeleteMerge` removed such a row within a second (`system.part_log`), which looks like insert-time filtering but is not. Queries that must never show expired data need their own `WHERE`.
- **`merge_with_ttl_timeout` is 14400 seconds.** After a TTL merge, ClickHouse waits up to four hours before the next one in the same partition, so expiry is late by design. `MATERIALIZE TTL` or `OPTIMIZE ... FINAL` force it.
- **The cut-off is midnight of the expiry day.** With `toDate(occurred_at) + INTERVAL 30 DAY`, rows dated 2026-10-02 expire at 2026-11-01 00:00, so on 2026-11-01 free tenants have 29 full days plus today. Add a day if "30 days" must mean 30 complete days.
- **`ttl_only_drop_parts = 1` only drops whole parts.** On a table with monthly partitions and a 50-day TTL, a partition with some expired and some live rows kept all of them. It is cheap (no rewrite) but coarse; with per-plan `WHERE` rules and parts that mix plans, expect little to be dropped.
- **The rule can read another table.** `TTL ... WHERE tenant_id IN (SELECT tenant_id FROM hypequery_examples.tenants WHERE plan = 'free')` was accepted (the table name must be qualified) and deleted the right rows. It is evaluated at merge time, so a tenant that upgrades after its rows were merged does not get them back. Stamping the plan on the row at ingest, as here, makes the rule explicit.
- **`now()` is accepted in a TTL expression.** `TTL d + (now() - toDateTime('2026-11-01'))` created without error. It is evaluated when the part is written or merged, so the expiry of a row depends on when that happens; avoid it.
- **MATERIALIZE TTL rewrites affected parts.** Here it took about 0.3 seconds for a million rows; on a large table it is a heavy mutation, so schedule it.

## Adapt it

- **Plans from a dictionary.** If events do not carry the plan, look it up at ingest with `dictGet` (see [dictionary-lookups](../dictionary-lookups)) and store it on the row.
- **Move instead of delete.** `TTL ... TO VOLUME 'cold'` moves old parts to cheaper storage; it needs a storage policy with that volume, which the seed server does not have, so it is not exercised here.
- **Roll up before deleting.** `TTL d + INTERVAL 30 DAY GROUP BY k SET v = sum(v)` collapsed 100 expired rows into one row per `k` after `OPTIMIZE ... FINAL` (the `GROUP BY` must be a prefix of `ORDER BY`). Or keep a materialized-view rollup ([materialized-view-rollups](../materialized-view-rollups)) with a longer TTL than the raw table.
- **Scope the dataset.** Set `tenantKey: 'tenant_id'` on the dataset so each tenant's dashboard only sees its own retained events.

## Related recipes

- [replacingmergetree-upserts](../replacingmergetree-upserts): the other merge-time behaviour that queries see before it happens.
- [dictionary-lookups](../dictionary-lookups): tenant attributes without a JOIN.

## Related examples

- [multi-tenant-embedded-analytics](../multi-tenant-embedded-analytics): per-tenant datasets over the same events.

Tested on ClickHouse 25.8 with `@hypequery/datasets` 0.29 and `@hypequery/clickhouse` 2.14.
