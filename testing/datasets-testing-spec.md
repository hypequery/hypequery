# @hypequery/datasets — Manual Testing Spec

A self-contained test plan for `@hypequery/datasets`, written so it can be handed to an
agent/model and executed end-to-end **against a real, already-populated ClickHouse
instance you provide**. There is **no data seeding** — the model **introspects your
schema, picks suitable tables/columns, defines dimensions and measures over them**, and
verifies dataset output against **ground truth computed from raw ClickHouse SQL**. That
keeps the tests data-agnostic: they pass on whatever real data you point them at.

It builds **one real, inspectable app** under `hq-datasets-test/` that you can open and
read afterwards (dataset definitions + a `sql/` dump + a vitest suite).

- **Package under test:** `@hypequery/datasets` (`v0.1.0`)
- **Companion:** `@hypequery/clickhouse` (query builder + execution)
- **Primary backend:** **ClickHouse** via `createDatasetClient({ queryBuilder: db })`.
- **Docs covered:** `datasets/overview`, `defining-datasets`, `dimensions`, `measures`, `metrics`, `filters`, `execution`, `time-grains`, `multi-tenancy`, `serve-integration`
- **Public API (verified against `src/index.ts`):**
  - `dataset`, `dimension`, `measure`
  - aggregation helpers: `sum`, `count`, `countDistinct`, `avg`, `min`, `max`
  - formula helpers: `divide`, `multiply`, `subtract`, `add`, `nullIfZero`, `coalesce`, `round`, `floor`, `ceil`
  - query helpers: `eq`, `neq`, `gt`, `gte`, `lt`, `lte`, `inList`, `notInList`, `between`, `like`, `asc`, `desc`, `filter`, `order`
  - relationships: `belongsTo`, `hasMany`, `hasOne`
  - clients/backends: `createDatasetClient`, `createInMemoryBackend`, `createDatasetRegistry`
  - validation/sql utils: `validateFilterValue`, `matchesFieldType`, `validateSQLIdentifier`, `isSafeSQLIdentifier`, `quoteSQLIdentifier`, `GRAIN_FUNCTIONS`

> **Ground-truth method.** For every value assertion, the test runs the equivalent
> hand-written query through the query builder (`db.table(...)` / `db.rawQuery(...)`) and
> compares it to the dataset/metric result. The dataset layer is correct iff its output
> matches the raw query over the **same** table. No magic numbers.

---

## 0. Prerequisites & schema discovery

### 0.1 Tooling & connection
- Node ≥ 18, `tsx`, `vitest`.
- **Your real ClickHouse.** Set `CLICKHOUSE_URL`, `CLICKHOUSE_DATABASE`, `CLICKHOUSE_USERNAME`, `CLICKHOUSE_PASSWORD` to point at the database you want tested. The tests only **read** — they never create or modify tables.

### 0.2 Create the app
```bash
mkdir hq-datasets-test && cd hq-datasets-test
npm init -y && npm pkg set type=module
npm install @hypequery/datasets @hypequery/clickhouse
npm install -D typescript tsx vitest @types/node dotenv
npx tsc --init --module nodenext --moduleResolution nodenext --target es2022 --strict
# .env with your CLICKHOUSE_* connection details
```

### 0.3 Files to create (your inspectable artifacts)
```
hq-datasets-test/
  src/
    client.ts            # createQueryBuilder against YOUR ClickHouse, exported as `db`
    discover.ts          # introspects the schema, prints tables/columns + a picked target
    datasets/target.ts    # the dataset you build over a chosen real table (exported)
    truth.ts             # helpers that compute ground truth via raw builder queries
    sql-dump.ts          # writes analytics.toSQL() for every scenario into sql/
  tests/
    clickhouse.test.ts   # behavioral assertions vs ground truth, run live
    backend.test.ts      # optional in-memory cross-check (§12)
  sql/                   # generated .sql files you can read
```

### 0.4 Discover the schema and choose a target table (`src/discover.ts`)
Introspect the live database and **choose a "fact-like" table** to model. Print the
result so the choice is inspectable.

```typescript
import 'dotenv/config';
import { db } from './client.js';

// List tables + columns from the connected database.
const rows = await db.rawQuery<{ table: string; name: string; type: string }>(
  `SELECT table, name, type FROM system.columns
   WHERE database = {db:String} ORDER BY table, position`,
  { db: process.env.CLICKHOUSE_DATABASE },
);
console.table(rows);
```

From the output, the model selects:
- **Target table** `T` — prefer a table with at least one numeric column and a timestamp.
- **Numeric column(s)** `Nᵢ` → `sum`/`avg`/`min`/`max`.
- **An id/high-cardinality column** → `count` / `countDistinct`.
- **A low-cardinality string column** `C` (e.g. status/country/type) → a groupable, filterable dimension.
- **A timestamp column** `TS` (if any) → `timeKey` + a `timestamp` dimension.
- **A low-cardinality column** `K` to act as the **tenant key** for the fail-closed tests (its real meaning doesn't matter — we're testing the enforcement mechanism).

Record the chosen names in the report; everything below refers to them as `T`, `Nᵢ`, `C`, `TS`, `K`.

### 0.5 Client (`src/client.ts`)
```typescript
import 'dotenv/config';
import { createQueryBuilder } from '@hypequery/clickhouse';
export const db = createQueryBuilder({
  url: process.env.CLICKHOUSE_URL!,
  username: process.env.CLICKHOUSE_USERNAME!,
  password: process.env.CLICKHOUSE_PASSWORD!,
  database: process.env.CLICKHOUSE_DATABASE!,
});
```

### 0.6 Build the target dataset (`src/datasets/target.ts`)
Fill this template using the columns chosen in §0.4. It must exercise: column mapping,
a SQL-backed dimension, a SQL-backed measure, a filtered measure, labels/descriptions, a
restricted filter contract, base + derived metrics, `tenantKey`, and `timeKey`.

```typescript
import { dataset, dimension, measure, eq, divide, nullIfZero } from '@hypequery/datasets';

export const Target = dataset('target', {
  source: 'T',                 // your chosen table
  tenantKey: 'K',              // a low-cardinality column used to test fail-closed tenancy
  timeKey: 'TS',               // a timestamp column (omit timeKey if the table has none)
  dimensions: {
    key: dimension.string({ column: 'K' }),          // column-mapped dimension
    category: dimension.string({ column: 'C' }),
    categoryUpper: dimension.string({ sql: 'upper(C)' }), // SQL-backed dimension
    ts: dimension.timestamp({ column: 'TS' }),
    // add an id dimension if useful for countDistinct mapping
  },
  measures: {
    total: measure.sum('N1', { label: 'Total', description: 'Sum of N1.' }),
    rows: measure.count('N1'),
    distinctKeys: measure.countDistinct('key'),       // mapped through the dimension
    avgN1: measure.avg('N1'),
    minN1: measure.min('N1'),
    maxN1: measure.max('N1'),
    scaledTotal: measure.sum('N1', { sql: 'N1 * 1.2' }),            // SQL-backed
    // pick a real value V that exists in column C for the filtered measure:
    filteredTotal: measure.sum('N1', { filters: [eq('category', 'V')] }),
  },
  filters: {
    category: { __type: 'filter_definition', field: 'category', operators: ['eq', 'neq', 'in', 'notIn'] },
  },
});

export const total = Target.metric('total', { measure: 'total', label: 'Total' });
export const rows = Target.metric('rows', { measure: 'rows' });
export const avgPerRow = Target.metric('avgPerRow', {
  uses: { total, rows },
  formula: ({ total, rows }) => divide(total, nullIfZero(rows)),
  label: 'Average per row',
  description: 'total / rows.',
});
```

### 0.7 Ground-truth helpers (`src/truth.ts`)
Compute expected values with the **builder** (or `db.rawQuery`) over the same table, so
assertions are derived from live data, not hardcoded:
```typescript
import { db } from './client.js';
export const sumN1 = async (allTenants = true) =>
  (await db.table('T').sum('N1', 'v').execute())[0]?.v;
export const sumN1ByCategory = async () =>
  db.table('T').select(['C']).sum('N1', 'v').groupBy('C').execute();
// ...add per-scenario truth helpers as needed.
```

### 0.8 Client construction (used by all tests)
```typescript
import { createDatasetClient } from '@hypequery/datasets';
import { db } from './client.js';
const analytics = createDatasetClient({ queryBuilder: db });
```
> Because `Target` has `tenantKey`, tenant-scoped targets need a `runtime.tenant`.
> For non-tenant assertions across the whole table, pass `{ runtime: { tenant: { scope: 'all' } } }`.
> Compute ground truth with the matching scope (whole table → no tenant predicate).

---

## 1. Definition & client construction

### D1.1 — Build the dataset
Import `Target`. **Pass:** loads without throw; `Target.name === 'target'`; `Target.metric` is a function.

### D1.2 — `createDatasetClient` requires a backend
- `createDatasetClient({})` → throws `createDatasetClient requires either queryBuilder or backend.`
- `createDatasetClient({ queryBuilder: db })` → ok.

### D1.3 — Connectivity smoke
`await analytics.execute(total, { dimensions: ['category'] }, { runtime: { tenant: { scope: 'all' } } })` returns rows. If it fails, fix ClickHouse/env before continuing.

---

## 2. Dimensions (`dimensions.mdx`)

Use `{ runtime: { tenant: { scope: 'all' } } }` unless a tenant is specified.

### D2.1 — Helper types
Define a scratch dataset using each of `dimension.string/number/boolean/timestamp`. **Pass:** all construct without error.

### D2.2 — Column mapping
`execute(Target, { dimensions: ['key'], measures: ['total'] }, allTenants)` →
- `toSQL` references the physical column `K`, not the semantic name `key`
- rows **equal** the ground truth `db.table('T').select(['K']).sum('N1','v').groupBy('K')`.

### D2.3 — SQL-backed dimension (`categoryUpper`)
`toSQL` for `dimensions: ['categoryUpper']` contains `upper(C)`; executes and matches `SELECT upper(C) ...` ground truth. Record whether a schema-compat **warning** is emitted (docs: complex SQL only warns).

### D2.4 — `groupable: false`
Add a scratch dimension with `groupable: false`; **record** whether selecting it as a dimension is rejected or merely flagged (docs say `groupable` "records intended behavior").

### D2.5 — `filterable` default + `filterable:false`
Add a scratch dimension with `filterable: false`; confirm `validate` rejects a filter on it. Default dimensions accept filters.

### D2.6 — Labels/descriptions are metadata only
`toSQL` is byte-identical whether or not `label`/`description` are set.

---

## 3. Measures (`measures.mdx`)

Each measure with no dimensions (one aggregate row), tenant `{ scope: 'all' }`, compared to the matching raw aggregate over `T`:

### D3.1 — All aggregation helpers
`total` == `sum(N1)`, `rows` == `count(N1)`, `distinctKeys` == `uniqExact(K)`/`count(distinct K)`, `avgN1` == `avg(N1)`, `minN1` == `min(N1)`, `maxN1` == `max(N1)`. Assert equality to ground truth.

### D3.2 — Filtered measure
`filteredTotal` == `sum(N1) WHERE C = 'V'` (ground truth with the same predicate).

### D3.3 — SQL-backed measure (builder path)
`scaledTotal`: `toSQL` contains `sum(N1 * 1.2)`; result == raw `sum(N1*1.2)`. (Rejection on a generic semantic backend is cross-checked in §12.)

### D3.4 — Measure field mapping through a dimension
`distinctKeys` (= `countDistinct('key')`): `toSQL` counts distinct physical `K`; result == raw `count(distinct K)`.

---

## 4. Metrics (`metrics.mdx`)

### D4.1 — Base metric execution
`execute(total, { dimensions: ['category'] }, allTenants)` **equals** `sumN1ByCategory()` ground truth (same rows/values, order-insensitive).

### D4.2 — Metric inherits measure label
`rows` metric omits `label`; confirm it inherits from the measure (inspect via schema/`describe`, or MCP `get_dataset_schema`). Record.

### D4.3 — Derived metric (`avgPerRow`)
`execute(avgPerRow, { dimensions: ['category'] }, allTenants)` equals, per category, `sum(N1)/count(N1)` from ground truth. Inspect `toSQL` — expect a CTE/formula dividing the two aggregates.

### D4.4 — Derived-metric guardrails (negative)
- `uses` referencing a metric from a **different** dataset → throws at definition time.
- Deriving from another **derived** metric → throws.

### D4.5 — Formula helpers
Build scratch derived metrics using `multiply`, `add`, `subtract`, `coalesce`, `round` (e.g. `round(divide(total, nullIfZero(rows)))`). Confirm each plans + executes; compare to the equivalent raw expression.

### D4.6 — `orderBy` on a metric
`execute(total, { dimensions:['category'], orderBy:[desc('total')], limit:2 }, allTenants)` returns the top-2 categories by `total`, matching a raw `ORDER BY sum(N1) DESC LIMIT 2`. Confirm `[{ field:'total', direction:'desc' }]` object form is equivalent.

---

## 5. Filters & ordering (`filters.mdx`)

### D5.1 — Each filter helper shape
`eq('category','V')` deep-equals `{ field:'category', operator:'eq', value:'V' }`. Spot-check `gt`, `inList`, `between`, `like`, `notInList`.

### D5.2 — Filters in metric queries
`execute(total, { dimensions:['category'], filters:[eq('category','V')] }, allTenants)` matches raw `... WHERE C='V' GROUP BY C`. Add a numeric filter `gte('N1', X)` for a real `X` and compare.

### D5.3 — Filters in dataset queries
`execute(Target, { dimensions:['category'], measures:['total','rows'], filters:[eq('category','V')] }, allTenants)` matches the equivalent raw query.

### D5.4 — Restricted filter contract
`filters.category` allows only `['eq','neq','in','notIn']`.
- `validate(total, { filters:[eq('category','V')] })` → valid.
- `validate(total, { filters:[like('category','%x%')] })` → **invalid** (operator not allowed). Record error.
- A filter on another dimension (not in the `filters` map) — record whether allowed (docs imply the listed field becomes the only exposed filter field).

### D5.5 — Order helpers
`orderBy: [desc('total'), asc('category')]` validates; `toSQL` shows `ORDER BY ... DESC, ... ASC`.

---

## 6. Execution surface (`execution.mdx`)

### D6.1 — `validate` returns data, not throws
`analytics.validate(total, { dimensions: ['category'] })` → `{ valid: true, errors: [] }`. Unknown dimension `nope` → `{ valid:false, errors:[...] }` **without throwing**.

### D6.2 — `toSQL` inspects + validates first
`analytics.toSQL(total, { dimensions:['category'], orderBy:[desc('total')], limit:10 })` contains `sum(N1)`, `GROUP BY`, `ORDER BY ... DESC`, `LIMIT`. Invalid query → `toSQL` **throws** the same validation errors. Dump all scenario SQL into `sql/`.

### D6.3 — `execute` returns rows + meta
`const r = await analytics.execute(total, { dimensions:['category'], limit:25 }, allTenants)`:
- `r.data` array; `r.meta?.sql`, `r.meta?.timingMs`, `r.meta?.rowCount` present
- `r.meta?.pagination` present because `limit` set (`{ limit:25, offset, hasMore }`).

### D6.4 — Pagination over-fetch / `hasMore`
Choose `limit` smaller than the distinct count of `C`. `execute(total, { dimensions:['category'], limit:L })` → `L` rows, `hasMore: true`. Confirm `meta.sql` over-fetches one row (`LIMIT L+1`) and issues **no** separate COUNT. With `limit` ≥ distinct count → `hasMore: false`.

### D6.5 — Dataset (ad hoc) execution
`execute(Target, { dimensions:['category'], measures:['total','rows'] }, allTenants)` matches the equivalent raw multi-aggregate query.

---

## 7. Time grains (`time-grains.mdx`)

Requires a `timeKey` (`TS`). If your chosen table has no timestamp, note it and skip the live parts (still verify `.by` is rejected without `timeKey`).

### D7.1 — `.by(grain)` requires `timeKey`
`total.by('month')` works (Target has `timeKey`). A scratch dataset **without** `timeKey` → `.by(...)`/execution rejected. Record.

### D7.2 — Each supported grain
For `day`, `week`, `month`, `quarter`, `year`: `analytics.toSQL(total.by(grain), { dimensions:['category'] })` buckets on `TS` (cross-check `GRAIN_FUNCTIONS`). For `month`, the result equals raw `SELECT toStartOfMonth(TS) AS bucket, sum(N1) ... GROUP BY bucket` (use the actual grain function the layer emits as ground truth).

### D7.3 — Unsupported grain
`total.by('hour' as any)` → rejected. Record message.

### D7.4 — `timeKey` is not a selectable dimension by itself
Selecting the raw `TS` column fails unless the `ts` timestamp dimension (mapped to `TS`) is used.

---

## 8. Multi-tenancy (`multi-tenancy.mdx`) — fail-closed

`Target` has `tenantKey: 'K'`. Pick a real value `K0` present in column `K`.

### D8.1 — Missing tenant context is rejected
`await analytics.execute(total)` → throws `Dataset "target" requires runtime tenant scoping.`

### D8.2 — Single tenant injects predicate
`execute(total, { dimensions:['category'] }, { runtime: { tenant: 'K0' } })`:
- `toSQL` contains `K = 'K0'` (or parameterized equivalent)
- result equals raw `... WHERE K='K0' GROUP BY C`.

### D8.3 — Tenant runtime value forms
- `tenant: 'K0'` and `tenant: { id: 'K0' }` → identical.
- `tenant: { in: ['K0','K1'] }` → equals raw `WHERE K IN ('K0','K1')` (pick a second real value `K1`).
- `tenant: { scope: 'all' }` → equals whole-table ground truth (no tenant predicate).

### D8.4 — Explicit tenant filter is rejected
`execute(total, { filters:[eq('key','K0')] }, { runtime: { tenant: 'K0' } })` → throws `Cannot filter on tenant field "key" when runtime tenancy enforcement is active.`

---

## 9. SQL identifier / validation utils

### D9.1 — `validateSQLIdentifier` / `isSafeSQLIdentifier`
`isSafeSQLIdentifier('valid_name')` → true; `isSafeSQLIdentifier('drop table; --')` → false. `validateSQLIdentifier('1bad', 'dimension name')` throws.

### D9.2 — `quoteSQLIdentifier`
Returns a backtick-quoted identifier. Confirm shape.

### D9.3 — `validateFilterValue` / `matchesFieldType`
`matchesFieldType('123', 'number')` and type/value mismatches behave per `ValidationResult`. Record.

---

## 10. Relationships (definition-level)

Docs note execution is currently same-dataset, but `belongsTo`/`hasMany`/`hasOne` exist and surface in schema introspection.

### D10.1 — Define relationships
Add a `relationships` block to a scratch dataset using `belongsTo`/`hasMany`/`hasOne` (reference a second real table). **Pass:** dataset constructs; relationship metadata is present (inspect, or verify later via MCP `get_dataset_schema`). Record whether any execution path consumes them yet.

---

## 11. End-to-end inspectable artifact

1. `src/sql-dump.ts` writes `analytics.toSQL(...)` for every scenario target into `sql/<name>.sql`. Keep the folder — human-inspectable generated SQL (sums, group-bys, time grains, tenant predicates, filtered/SQL-backed measures).
2. `tests/clickhouse.test.ts` encodes §2–§8 as **dataset-result vs raw-builder ground truth** comparisons against your live ClickHouse. Run `npx vitest run` → all green.

**Pass:** `sql/` contains correctly shaped SQL; live tests pass because dataset output matches the equivalent hand-written queries over the same tables.

---

## 12. Optional: in-memory backend cross-check

Only to verify the one backend-specific behavior and offer a DB-free smoke path. Build
`createInMemoryBackend(tables)` with a handful of rows you define inline (this is a unit
fixture for the adapter, **not** a seed of your real DB):

### D12.1 — SQL-backed measures rejected by generic semantic backend
`execute(..., 'scaledTotal', ...)` on the **in-memory** client → **throws** (docs: generic semantic plans reject SQL-backed measures). Record the message. This is the one place backend choice changes behavior.

### D12.2 — Backend/builder guard
A backend-only client calling a builder-only path → throws `This dataset client was created with a semantic backend, not a query builder.`

---

## 13. Reporting template
Record the chosen `T/Nᵢ/C/TS/K` first. Per scenario: target + query JSON, expected (ground-truth query + value/shape) vs actual, PASS/FAIL, notes. Attach the `sql/` dump and vitest output. Confirm/deny Appendix A.

---

## Appendix A — Things to confirm against docs
- **CLI `generate:datasets` example (FIXED).** The CLI's success message previously printed `createDatasetClient({ backend: createBackend({...}) })` with `import { createBackend } from '@hypequery/clickhouse'` — but `createBackend` is only exported from the `@hypequery/clickhouse/datasets` **subpath**, not the root. The message now uses `createQueryBuilder` + `createDatasetClient({ queryBuilder: db })`.
- **`groupable` enforcement:** docs say `groupable: false` "records intended behavior" rather than hard-blocking. Record actual enforcement (D2.4).
- **Restricted-filter map scope:** docs imply adding a `filters` map makes the listed field the only exposed filter field. Confirm filters on other dimensions are then rejected (D5.4).
- **SQL-backed measures on generic semantic backend:** confirm rejection on the in-memory backend but success on the ClickHouse builder (D3.3 vs D12.1).
- **Pagination metadata:** confirm `meta.pagination` only appears when `limit` is set and that `hasMore` uses over-fetch, not a COUNT (D6.3–D6.4).
- **Relationships:** confirm whether any execution path consumes `belongsTo`/`hasMany`/`hasOne` yet, or they're introspection-only for now (D10.1).
