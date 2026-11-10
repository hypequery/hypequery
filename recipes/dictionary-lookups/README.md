# Tenant lookups with a ClickHouse dictionary and dictGet in a typed dataset

Load tenant plan and region into a ClickHouse dictionary, expose them as dataset dimensions via dictGet, and check the result and timing against a JOIN.

**Short answer:** `CREATE DICTIONARY` loads a small table (here 200 tenants) into memory as a key-value map, and `dictGet('dict', 'plan', tenant_id)` reads an attribute for each row without a JOIN. In a hypequery dataset that is a dimension with `sql: "dictGet(...)"`: callers group and filter by `plan` and `region` as if they were columns on `events`. On the seed it returns exactly the same rows as the relationship JOIN, reads 200 fewer rows, and was faster in every batch we ran, by tens of milliseconds rather than multiples. The trade is freshness: the dictionary serves what it loaded until it reloads.

## Demo

```text
Events per plan and region, 2026-10-01 to 2026-10-31

plan        region    events  tenants
enterprise  ap-south    1382        1
enterprise  eu-west    58380        8
enterprise  us-east    32562        9
enterprise  us-west    23406        4
free        ap-south      46        7
free        eu-west       41        8
free        us-east      138       22
free        us-west       54        6
growth      ap-south    1476        3
growth      eu-west     4233       10
growth      us-east    11308       21
growth      us-west     4118        6
starter     ap-south     556        9
starter     eu-west      680       19
starter     us-east     1128       19
starter     us-west      236        7

JOIN version returns the same rows: true
dictGet  median 58 ms  runs 50/56/58/78/133 ms  read 139744 rows  peak memory 6.4 MB
join     median 75 ms  runs 63/72/75/76/80 ms  read 139944 rows  peak memory 5.3 MB
```

The timing lines are one run of `pnpm dev` on a laptop ClickHouse that other work was using at the same time. Over four batches of 5 to 15 runs, dictGet medians were 35 to 58 ms and JOIN medians 54 to 75 ms; peak memory was within about 1 MB either way, in both directions. Rows read are exact: the JOIN reads the same 139,744 event rows plus the 200 tenants.

## Install

```bash
npx @hypequery/cli create dictionary-lookups -y
cd dictionary-lookups
docker compose -f ../examples/_seed/docker-compose.yml up -d --wait && pnpm seed   # or set CLICKHOUSE_* for your own ClickHouse
pnpm install
pnpm dev        # creates the dictionary, runs both versions, times them
pnpm teardown   # drops the dictionary and its source table
```

Setup copies `tenants` into `dictionary_lookups_tenants_source` and builds the dictionary from that copy, so the smoke test can change a plan without touching the seed.

## The SQL

```sql
CREATE DICTIONARY dictionary_lookups_tenants
(
    tenant_id  UInt64,
    plan       String,
    region     String
)
PRIMARY KEY tenant_id
SOURCE(CLICKHOUSE(TABLE 'dictionary_lookups_tenants_source' DB 'hypequery_examples' USER 'default' PASSWORD '...'))
LAYOUT(HASHED())
LIFETIME(MIN 300 MAX 600);

SYSTEM RELOAD DICTIONARY dictionary_lookups_tenants;   -- load now, not on first use
```

A dictionary reads its source over its own connection, so a table on the same server still needs `USER` and `PASSWORD`; without them, loading failed with `Authentication failed` for a `default` user that has a password. `src/setup.ts` fills them in from `CLICKHOUSE_USERNAME` and `CLICKHOUSE_PASSWORD`. ClickHouse shows the password as `[HIDDEN]` in `SHOW CREATE DICTIONARY` and in `system.query_log`. In production, give the dictionary a read-only user or a named collection.

## The dataset

```ts
plan: dimension.string({
  sql: "dictGet('dictionary_lookups_tenants', 'plan', tenant_id)",
  dependencies: ['tenant_id'],
  label: 'Plan',
}),
```

`src/dataset.ts` defines `Events` with `plan` and `region` from the dictionary, and `EventsJoined`, the same events with a `tenant` relationship (`belongsTo` the tenants table), queried as `tenant.plan` and `tenant.region`. The generated SQL for the dictionary version has no JOIN (see `expected.sql`); the relationship version renders a `LEFT ANY JOIN` to a subquery over the tenants table. The dictionary name is unqualified, so it resolves in the connection's database.

## Trade-offs and pitfalls (checked on 25.8)

- **Stale until reload.** After changing tenant 1 to `enterprise` in the source table, `dictGet` still returned `starter` and the two versions disagreed; after `SYSTEM RELOAD DICTIONARY` they matched again. With `LIFETIME(MIN 300 MAX 600)` ClickHouse reloads on its own somewhere in that 5 to 10 minute window (per the docs; the recipe forces the reload rather than wait). Use the JOIN, or reload after writes, when a change must show up at once.
- **A missing key is not NULL.** `dictGet` for an unknown tenant returned `''` (the attribute's default); the LEFT JOIN returned `NULL`, which hypequery's relationship keeps. Use `dictGetOrDefault(..., 'unknown')` or check `dictHas` when unknown keys are possible.
- **FLAT is capped.** `LAYOUT(FLAT())` is an array indexed by key; a key of 600000 failed with `identifier should be less than 500000`. `HASHED()` has no such limit; FLAT is worth it only for small, dense integer keys.
- **Lazy loading.** `dictionaries_lazy_load` is 1 on this server, so a dictionary loads on its first `dictGet` and that query pays for it. Setup runs `SYSTEM RELOAD DICTIONARY` to load it up front.
- **Memory is the source's size.** 200 tenants took 29 KB with `HASHED()` and 38 KB with `FLAT()` (`system.dictionaries.bytes_allocated`). A dictionary sits in RAM on every server that uses it, so it suits dimension tables, not facts.
- **The JOIN is not slow here.** With 200 tenants the JOIN's hash table is tiny. Expect the gap to grow with the size of the right-hand table; measure on your data with `time()` in `src/recipe.ts` before switching.

## Adapt it

- **More attributes.** Add `industry String` to the dictionary and a third dimension; a query only looks up the attributes it selects.
- **Composite keys.** `LAYOUT(COMPLEX_KEY_HASHED())` with `PRIMARY KEY tenant_id, user_id`, looked up with `dictGet('dict', 'role', (toUInt64(tenant_id), toUInt64(user_id)))`, worked over the seed `users` table.
- **Stamp at ingest.** For values that must not change after the fact (the plan when the event happened), call `dictGet` in a materialized view or `INSERT ... SELECT` and store the result on the row; [ttl-data-retention](../ttl-data-retention) uses a stamped plan.
- **Tenant scoping.** `tenantKey: 'tenant_id'` on the dataset still works; the dictionary only supplies labels.

## Related recipes

- [ttl-data-retention](../ttl-data-retention): retention rules keyed on the tenant's plan.

## Related examples

- [multi-tenant-embedded-analytics](../multi-tenant-embedded-analytics): tenant-scoped datasets over the same events.

Tested on ClickHouse 25.8 with `@hypequery/datasets` 0.29 and `@hypequery/clickhouse` 2.14.
