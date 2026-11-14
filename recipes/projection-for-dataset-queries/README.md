# Add a ClickHouse projection that a typed dataset query uses automatically

Add a sort-key and an aggregate projection to a ClickHouse table, then prove with EXPLAIN and query_log that an unchanged dataset query reads from them.

**Short answer:** `ALTER TABLE t ADD PROJECTION p (SELECT ... ORDER BY ...)` stores a second copy of the rows in another order; `ADD PROJECTION p (SELECT keys, aggregates GROUP BY keys)` stores a pre-aggregated copy. Run `ALTER TABLE t MATERIALIZE PROJECTION p` so existing parts get it too. After that ClickHouse picks the projection per query, on its own: the SQL, and the hypequery dataset that generates it, stay exactly the same. On the seed's million events, a week of daily totals drops from 131,552 rows read to 186, and a lookup by user from 1,000,000 to 98,304. Whether a projection or a materialized view is the right tool is covered in [ClickHouse projections vs materialized views](https://hypequery.com/blog/clickhouse-projections-vs-materialized-views); this recipe is the runnable half.

## Demo

```text
Daily events, 2026-10-25 to 2026-10-31

day          events  totalLatencyMs  avgLatencyMs
2026-10-25     2144          536478        250.22
2026-10-26     5551         1410483        254.10
2026-10-27     5548         1411296        254.38
2026-10-28     5491         1409198        256.64
2026-10-29     5749         1426139        248.07
2026-10-30     5612         1447614        257.95
2026-10-31     2239          587427        262.36

daily query: projection daily_by_type read 186 rows; without projections 131552 rows
user query: projection by_user read 98304 rows; without projections 1000000 rows
```

## Install

```bash
npx @hypequery/cli create projection-for-dataset-queries -y
cd projection-for-dataset-queries
docker compose -f ../examples/_seed/docker-compose.yml up -d --wait && pnpm seed   # or set CLICKHOUSE_* for your own ClickHouse
pnpm install
pnpm dev        # creates projection_for_dataset_queries_events, runs both queries
pnpm teardown   # drops it again
```

Setup copies `events` into `projection_for_dataset_queries_events` and adds the projections there, so the shared seed tables are never altered.

## The SQL

```sql
-- Same rows, sorted by user: for "everything about one user".
ALTER TABLE projection_for_dataset_queries_events
    ADD PROJECTION by_user (SELECT * ORDER BY user_id, occurred_at);

-- One pre-aggregated row per (day, event_type) per part.
ALTER TABLE projection_for_dataset_queries_events
    ADD PROJECTION daily_by_type
    (
        SELECT toDate(occurred_at), event_type, count(), sum(latency_ms)
        GROUP BY toDate(occurred_at), event_type
    );

-- ADD PROJECTION only covers parts written from now on.
ALTER TABLE projection_for_dataset_queries_events MATERIALIZE PROJECTION by_user SETTINGS mutations_sync = 1;
ALTER TABLE projection_for_dataset_queries_events MATERIALIZE PROJECTION daily_by_type SETTINGS mutations_sync = 1;
```

## The dataset

`src/dataset.ts` is an ordinary events dataset: nothing in it names a projection. The one choice made for the aggregate projection is a `day` dimension whose SQL is exactly the projection key:

```ts
day: dimension.timestamp({ sql: 'toDate(occurred_at)', dependencies: ['occurred_at'], label: 'Day' }),
```

The query groups and filters on it:

```ts
export const query = {
  dimensions: ['day'],
  measures: ['events', 'totalLatencyMs', 'avgLatencyMs'],
  filters: [between('day', '2026-10-25', '2026-10-31')],
  orderBy: [{ field: 'day', direction: 'asc' }],
} satisfies DatasetQueryFor<typeof Events>;
```

`avgLatencyMs` is a derived measure (`totalLatencyMs / events`), so the generated SQL wraps the aggregate in a CTE. ClickHouse still matches the projection inside it.

## Proof it is used

`EXPLAIN projections = 1` on the generated SQL, with the parameters filled in:

```text
Expression (...)
  Sorting (Sorting for ORDER BY)
    Expression (...)
      Aggregating
        Filter
          ReadFromMergeTree (daily_by_type)
```

The `ReadFromMergeTree (<projection>)` line is the one to look for; reading the base table shows `ReadFromMergeTree (hypequery_examples.projection_for_dataset_queries_events)`. EXPLAIN is a plan, so `src/recipe.ts` also checks what really ran: `profile()` executes the compiled SQL with a known `query_id`, once with `optimize_use_projections = 1` and once with `0`, and reads `projections` and `read_rows` from `system.query_log`:

| Query | Projection used | Rows read | Rows read without projections |
| --- | --- | ---: | ---: |
| Daily events for a week (`query`) | `daily_by_type` | 186 | 131,552 |
| One user's events by type (`userQuery`) | `by_user` | 98,304 | 1,000,000 |

The results are identical either way; the smoke test asserts that, and checks both answers against hand-written SQL over the seed `events` table. Rows-read figures depend on how many parts the table has, so the test asserts the ratio, not the exact numbers.

## Trade-offs and pitfalls (checked on 25.8)

- **The WHERE clause must be answerable from the projection.** Filtering the same daily query on the raw timestamp (`between('occurredAt', ...)`) reads the base table: the projection only stores `toDate(occurred_at)`, so it cannot answer a sub-day range. The same is true of `by: 'day'`, which buckets with `toStartOfDay(toDateTime64(occurred_at, 9, 'UTC'))` rather than the projection's key. Both cases are in the smoke test. Give the dataset a dimension that is exactly the projection key and query through it.
- **`ADD PROJECTION` does not backfill.** Before `MATERIALIZE PROJECTION`, `EXPLAIN` on an existing table showed the base table; after it, the projection. Materializing is a mutation that builds the projection for every existing part; on this million-row table each took under half a second (`system.query_log`), on billions of rows schedule it.
- **Storage.** `by_user` is a full second copy: 15.6 MiB beside the table's 18.2 MiB (`system.projection_parts`). `daily_by_type` is 2,190 rows and 18 KiB. Every insert writes both.
- **Deletes are blocked by default.** `DELETE FROM` on a table with projections fails with `lightweight_mutation_projection_mode is set to THROW`; set it to `drop` or `rebuild`, or use `ALTER TABLE ... DELETE`, which worked.
- **ReplacingMergeTree needs a setting.** `CREATE TABLE ... ENGINE = ReplacingMergeTree` with a projection fails unless `deduplicate_merge_projection_mode` is `drop` or `rebuild`.
- **No WHERE or JOIN inside a projection.** Both are syntax errors in the projection's SELECT. A filtered or joined copy is a materialized view's job, as is a rollup that should outlive the raw rows or live in another table you query directly; see the [projections vs materialized views](https://hypequery.com/blog/clickhouse-projections-vs-materialized-views) decision table.

## Adapt it

- **Your own key.** Replace `user_id` with whatever your second most common filter is (`path`, `session_id`). The dataset does not change.
- **Hourly instead of daily.** Use `toStartOfHour(occurred_at)` in the projection and in the `sql` of the dimension; the two must match.
- **More measures.** Add the aggregates you query (`uniq(user_id)`, `max(latency_ms)`) to the projection's SELECT. A query that asks for an aggregate the projection does not store reads the base table.
- **Check in CI.** `profile()` returns the projection name; asserting it, as the smoke test does, catches a schema or query change that silently stops using it.

## Related recipes

- [p95-latency](../p95-latency): the same events dataset, without projections.

## Related examples

- [materialized-view-rollups](../materialized-view-rollups): the materialized-view route, a rollup table with its own dataset.

Versions used: ClickHouse 25.8, `@hypequery/datasets` 0.29 and `@hypequery/clickhouse` 2.14.
