# Upserts and deletes in ClickHouse with ReplacingMergeTree and a typed dataset

Upsert and delete rows with ReplacingMergeTree, read the latest version with FINAL or argMax, and pin the results before and after OPTIMIZE.

**Short answer:** ClickHouse has no in-place upsert. Use `ENGINE = ReplacingMergeTree(version, is_deleted)` with the row's key as `ORDER BY`, and write every change, including a delete, as a new row with a higher `version`. Old versions disappear only when parts merge, which happens on ClickHouse's schedule, so a plain `SELECT` sees duplicates. Read with `FINAL` (hypequery: `rowResolution: { kind: 'final', engine: 'replacing', deletedColumn: 'is_deleted' }` on the dataset) or with `argMax(col, version) ... GROUP BY key`. Both give the right answer before and after merges; a plain count is wrong in both states, even after `OPTIMIZE TABLE ... FINAL`, because deleted keys stay stored as tombstones. When to pick `FINAL`, `argMax` or `LIMIT 1 BY` for performance is covered in [FINAL vs ReplacingMergeTree dedup in TypeScript queries](https://hypequery.com/blog/clickhouse-final-replacingmergetree-typescript).

## Demo

```text
Before OPTIMIZE (merges held: 4 parts, 247 rows)

plan        rawRows  final  argMax
enterprise       28     26      26
free            104     73      73
growth           47     40      40
starter          68     53      53

After OPTIMIZE TABLE ... FINAL (1 part)

plan        rawRows  final  argMax
enterprise       27     26      26
free             76     73      73
growth           40     40      40
starter          57     53      53
```

`final` and `argMax` are the 192 live tenants. `rawRows` is every stored row: 247 versions before the merge, 200 after it (192 live rows plus 8 tombstones). Both states are pinned in `states.json`; `output.json` is the `final` column.

## Install

```bash
npx hypequery create replacingmergetree-upserts -y
cd replacingmergetree-upserts
docker compose -f ../examples/_seed/docker-compose.yml up -d --wait && pnpm seed   # or set CLICKHOUSE_* for your own ClickHouse
pnpm install
pnpm dev        # creates the table, prints both states, runs OPTIMIZE between them
pnpm teardown   # drops the table and the view
```

Everything lives in `replacingmergetree_upserts_tenants` and `replacingmergetree_upserts_tenants_latest`; the seed tables are only read.

## The SQL

```sql
CREATE TABLE replacingmergetree_upserts_tenants
(
    tenant_id UInt32, name String, plan LowCardinality(String), region LowCardinality(String),
    version DateTime('UTC'),   -- highest wins
    is_deleted UInt8           -- 1 on the winning row = the key is deleted
)
ENGINE = ReplacingMergeTree(version, is_deleted)
ORDER BY tenant_id;            -- the upsert key
```

`sql/setup.sql` then writes four batches, each its own part: the 200 seed tenants (version = `created_at`), 19 plan upgrades (version 2026-11-01), 8 deletes (`is_deleted = 1`, version 2026-11-02), and 20 stale rows inserted last but versioned before the tenant existed. Insertion order does not matter; the version does, so the stale rows lose.

The argMax alternative is a view:

```sql
CREATE OR REPLACE VIEW replacingmergetree_upserts_tenants_latest AS
SELECT tenant_id,
       argMax(name, version) AS name, argMax(plan, version) AS plan, argMax(region, version) AS region,
       max(version) AS latest_version
FROM replacingmergetree_upserts_tenants
GROUP BY tenant_id
HAVING argMax(is_deleted, version) = 0;
```

## The dataset

`src/dataset.ts` defines the same dimensions three times: `Tenants` (FINAL, the one to use), `TenantVersions` (no FINAL, to show the raw state) and `TenantsLatest` (over the argMax view). The query is the same for each:

```ts
export const query = {
  dimensions: ['plan'],
  measures: ['tenants'],
  orderBy: [{ field: 'plan', direction: 'asc' }],
} satisfies DatasetQueryFor<typeof Tenants>;
```

On `Tenants` it generates `FROM replacingmergetree_upserts_tenants FINAL WHERE replacingmergetree_upserts_tenants.is_deleted = ?` (see `expected.sql`). The smoke test checks the result against the upserts applied by hand to the seed `tenants` table.

## Trade-offs and pitfalls (checked on 25.8)

- **Filter after resolving, never before.** A dataset filter on `Tenants` or `TenantsLatest` (`eq('plan', 'free')`) gives 73. Hand-written argMax with the filter in the inner `WHERE` gives 91: it drops each tenant's newer rows first, so an upgraded tenant's old `free` row wins again. With `FINAL`, ClickHouse applied the non-key `WHERE` after the merge (`optimize_move_to_prewhere_if_final` is 0 by default).
- **OPTIMIZE does not remove deletes.** After `OPTIMIZE TABLE ... FINAL` the table has one part and 200 rows, 8 of them `is_deleted = 1`. `OPTIMIZE ... FINAL CLEANUP` drops them, but fails with `Experimental merges with CLEANUP are not allowed` unless the table has `allow_experimental_replacing_merge_with_cleanup = 1`.
- **OPTIMIZE does not merge across partitions.** With `PARTITION BY toYYYYMM(d)` and one key written in January and February, `OPTIMIZE ... FINAL` kept both rows; `SELECT ... FINAL` still returned one, because `do_not_merge_across_partitions_select_final` is 0. Keep the partition key stable for a given row key.
- **Equal versions.** Two rows with the same key and version: `FINAL` kept the one inserted last. `argMax` picks one of the tied rows without a guarantee. Use a version that strictly increases per change (an update timestamp with enough precision, or a sequence).
- **Do not alias over the version column.** `max(version) AS version` in the view fails with `Aggregate function max(version) AS version is found inside another aggregate function`: the alias shadows the column inside `argMax(..., version)`. Name it `latest_version`.
- **Deterministic tests need merges held.** A background merge can land between two queries, so `sql/setup.sql` runs `SYSTEM STOP MERGES` on the table; `OPTIMIZE` then fails with `Cancelled merging parts` until `SYSTEM START MERGES`. That is a test technique, not something to run in production.
- **FINAL has a read-time cost** that grows with the number of unmerged parts and rows per key. On 200 tenants it is invisible; on a large fact table, measure before putting it on a hot path.

## Adapt it

- **Your own key.** `ORDER BY` is the upsert key: `(tenant_id, user_id)` for per-tenant users, `subscription_id` for subscriptions.
- **No deletes.** Drop `is_deleted` from the engine and use `rowResolution: { kind: 'final' }`.
- **Point a relationship at it.** A `belongsTo` relationship to a `rowResolution` dataset joins a `FINAL ... WHERE is_deleted = 0` subquery, so facts are grouped by the current plan, not every historical one.
- **Read it from the query builder.** Outside datasets, `db.table('replacingmergetree_upserts_tenants').final()` and `.argMax()` cover the same two patterns.

## Related recipes

- [projection-for-dataset-queries](../projection-for-dataset-queries): projections on ReplacingMergeTree need `deduplicate_merge_projection_mode`.

## Related examples

- [multi-tenant-embedded-analytics](../multi-tenant-embedded-analytics): tenant-scoped datasets over the same tenants.

Tested on ClickHouse 25.8 with `@hypequery/datasets` 0.29 and `@hypequery/clickhouse` 2.14.
