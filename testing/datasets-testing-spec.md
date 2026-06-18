# @hypequery/datasets — Manual Testing Spec

A self-contained test plan for `@hypequery/datasets`, written so it can be handed to an
agent/model and executed end-to-end **against a real ClickHouse instance you set up**.
It builds **one real, inspectable app** under `hq-datasets-test/` that you can open and
read afterwards, plus a battery of scenarios covering every documented feature.

- **Package under test:** `@hypequery/datasets` (`v0.1.0`)
- **Companion:** `@hypequery/clickhouse` (query builder + execution)
- **Primary backend:** **ClickHouse** via `createDatasetClient({ queryBuilder: db })`. Every behavioral, SQL, and execution test runs against your real ClickHouse, seeded with fixed rows (§0.4) so result assertions are exact.
- **Docs covered:** `datasets/overview`, `defining-datasets`, `dimensions`, `measures`, `metrics`, `filters`, `execution`, `time-grains`, `multi-tenancy`, `serve-integration`
- **Public API (verified against `src/index.ts`):**
  - `dataset`, `dimension`, `measure`
  - aggregation helpers: `sum`, `count`, `countDistinct`, `avg`, `min`, `max`
  - formula helpers: `divide`, `multiply`, `subtract`, `add`, `nullIfZero`, `coalesce`, `round`, `floor`, `ceil`
  - query helpers: `eq`, `neq`, `gt`, `gte`, `lt`, `lte`, `inList`, `notInList`, `between`, `like`, `asc`, `desc`, `filter`, `order`
  - relationships: `belongsTo`, `hasMany`, `hasOne`
  - clients/backends: `createDatasetClient`, `createInMemoryBackend`, `createDatasetRegistry`
  - validation/sql utils: `validateFilterValue`, `matchesFieldType`, `validateSQLIdentifier`, `isSafeSQLIdentifier`, `quoteSQLIdentifier`, `GRAIN_FUNCTIONS`

> The in-memory backend (`createInMemoryBackend`) is **optional** here. It is used only in
> §12 to cross-check the one documented backend-specific behavior (SQL-backed measures
> are rejected by generic semantic plans) and as a DB-free smoke option. Everything else
> runs on ClickHouse so you exercise real SQL generation and execution.

---

## 0. Prerequisites & the app skeleton

### 0.1 Tooling
- Node ≥ 18, `tsx` (or `ts-node`) to run TS scripts directly, `vitest` for assertions.
- A real ClickHouse you control. Reuse the container from **`cli-testing-spec.md` §0.2**, but this app uses its **own dedicated database `ds_test`** and **its own seed** (§0.4) so it never collides with the CLI spec's tables.

### 0.2 Create the app
```bash
mkdir hq-datasets-test && cd hq-datasets-test
npm init -y
npm pkg set type=module
npm install @hypequery/datasets @hypequery/clickhouse
npm install -D typescript tsx vitest @types/node
npx tsc --init --module nodenext --moduleResolution nodenext --target es2022 --strict
```

Create `.env` (loaded by your scripts via `import 'dotenv/config'` or shell export):
```bash
CLICKHOUSE_URL=http://localhost:8123
CLICKHOUSE_DATABASE=ds_test
CLICKHOUSE_USER=cli_user
CLICKHOUSE_PASSWORD=super-secret
```

### 0.3 Files to create (these are your inspectable artifacts)
```
hq-datasets-test/
  seed.sql              # dedicated ds_test.orders table + fixed rows (§0.4)
  src/
    client.ts           # createQueryBuilder (ClickHouse), exported as `db`
    datasets/orders.ts   # the canonical Orders dataset + metrics (exported)
    sql-dump.ts          # prints toSQL() for every scenario into sql/ for inspection
  tests/
    clickhouse.test.ts   # ALL behavioral assertions, run live against ClickHouse
    backend.test.ts      # optional in-memory cross-check (§12)
  sql/                   # generated .sql files you can read
```

### 0.4 Seed (fixed rows so assertions are exact) — `seed.sql`
Run via: `docker exec -i hq-ch clickhouse-client --user cli_user --password super-secret < seed.sql`
```sql
CREATE DATABASE IF NOT EXISTS ds_test;

CREATE TABLE ds_test.orders (
  id          UInt64,
  tenant_id   String,
  customer_id String,
  status      String,
  country     String,
  email       String,
  amount      Float64,
  created_at  DateTime
) ENGINE = MergeTree ORDER BY (created_at, id);

INSERT INTO ds_test.orders
  (id, tenant_id, customer_id, status, country, email, amount, created_at) VALUES
  (1, 't1', 'c1', 'completed', 'US', 'a@example.com', 100, '2026-01-05 00:00:00'),
  (2, 't1', 'c1', 'completed', 'US', 'b@example.com',  50, '2026-01-20 00:00:00'),
  (3, 't1', 'c2', 'refunded',  'UK', 'c@example.com',  30, '2026-02-02 00:00:00'),
  (4, 't2', 'c3', 'completed', 'CA', 'd@example.com', 200, '2026-02-10 00:00:00');

-- Used by the serve/react specs' `activeUsers` query-builder example.
CREATE TABLE ds_test.users (
  id          String,
  email       String,
  status      String,
  created_at  DateTime
) ENGINE = MergeTree ORDER BY (created_at, id);

INSERT INTO ds_test.users (id, email, status, created_at) VALUES
  ('u1', 'a@example.com', 'active',   '2026-01-01 00:00:00'),
  ('u2', 'b@example.com', 'active',   '2026-01-02 00:00:00'),
  ('u3', 'c@example.com', 'inactive', '2026-01-03 00:00:00');
```

> **Shared seed.** This `ds_test` database (orders + users) is the canonical seed reused
> by the **serve**, **MCP**, and **React** specs too, since they all build on the same
> `Orders` dataset. Point `CLICKHOUSE_DATABASE=ds_test` in those apps.

**Derived expected values (used throughout):**
| Quantity | Value |
| --- | --- |
| `revenue` = sum(amount) | 380 |
| `orderCount` = count(id) | 4 |
| `uniqueCountries` = countDistinct(country) | 3 (US, UK, CA) |
| `avgAmount` | 95 |
| `minAmount` / `maxAmount` | 30 / 200 |
| `completedRevenue` (status=completed) | 350 (100+50+200) |
| `taxedRevenue` = sum(amount*1.2) | 456 |
| revenue by country | US 150, UK 30, CA 200 |
| AOV by country (revenue/orderCount) | US 75, UK 30, CA 200 |
| revenue, filter completed + amount≥100 | US 100, CA 200 |
| revenue desc, limit 2 | CA 200, US 150 |
| revenue by month | 2026-01 = 150, 2026-02 = 230 |
| revenue, tenant `t1` | US 150, UK 30 |
| revenue, tenant `t2` | CA 200 |
| `uniqueCustomers` = countDistinct(customer_id) | 3 (c1, c2, c3) |

### 0.5 Client (`src/client.ts`)
```typescript
import { createQueryBuilder } from '@hypequery/clickhouse';
export const db = createQueryBuilder({
  url: process.env.CLICKHOUSE_URL!,
  username: process.env.CLICKHOUSE_USER!,
  password: process.env.CLICKHOUSE_PASSWORD!,
  database: process.env.CLICKHOUSE_DATABASE!,
});
```

### 0.6 Canonical dataset (`src/datasets/orders.ts`)
Build this once; every scenario reuses it. It exercises column mapping, SQL-backed
fields, filtered measures, labels/descriptions, a restricted filter contract, base +
derived metrics, `tenantKey`, and `timeKey`.

```typescript
import { dataset, dimension, measure, eq, divide, nullIfZero } from '@hypequery/datasets';

export const Orders = dataset('orders', {
  source: 'orders',                 // ds_test.orders
  tenantKey: 'tenant_id',
  timeKey: 'created_at',
  dimensions: {
    id: dimension.number(),
    tenantId: dimension.string({ column: 'tenant_id' }),
    customerId: dimension.string({ column: 'customer_id' }),
    status: dimension.string({ label: 'Order Status', description: 'Lifecycle state.' }),
    country: dimension.string(),
    countryUpper: dimension.string({ sql: 'upper(country)' }),    // SQL-backed
    email: dimension.string({ filterable: true, groupable: false }),
    createdAt: dimension.timestamp({ column: 'created_at' }),
  },
  measures: {
    revenue: measure.sum('amount', { label: 'Revenue', description: 'Order amount.' }),
    orderCount: measure.count('id'),
    uniqueCountries: measure.countDistinct('country'),
    uniqueCustomers: measure.countDistinct('customerId'),
    avgAmount: measure.avg('amount'),
    minAmount: measure.min('amount'),
    maxAmount: measure.max('amount'),
    taxedRevenue: measure.sum('amount', { sql: 'amount * 1.2' }),           // SQL-backed
    completedRevenue: measure.sum('amount', { filters: [eq('status', 'completed')] }), // filtered
  },
  filters: {
    status: { __type: 'filter_definition', field: 'status', operators: ['eq', 'neq', 'in', 'notIn'] },
  },
});

export const revenue = Orders.metric('revenue', { measure: 'revenue', label: 'Total Revenue' });
export const orderCount = Orders.metric('orderCount', { measure: 'orderCount' });
export const averageOrderValue = Orders.metric('averageOrderValue', {
  uses: { revenue, orderCount },
  formula: ({ revenue, orderCount }) => divide(revenue, nullIfZero(orderCount)),
  label: 'Average Order Value',
  description: 'Revenue divided by order count.',
});
```

### 0.7 Client construction (used by all tests)
```typescript
import { createDatasetClient } from '@hypequery/datasets';
import { db } from './client.js';
const analytics = createDatasetClient({ queryBuilder: db });
```
> Because `Orders` has `tenantKey`, tenant-scoped targets need a `runtime.tenant` (see §8).
> For non-tenant assertions on the full dataset, pass a trusted `{ runtime: { tenant: { scope: 'all' } } }` context, OR query a tenant explicitly. Each scenario states which.

---

## 1. Definition & client construction

### D1.1 — Build the dataset
**Run** a script importing `Orders`. **Expect:** loads without throw; `Orders.name === 'orders'`; `Orders.metric` is a function.

### D1.2 — `createDatasetClient` requires a backend
- `createDatasetClient({})` → throws `createDatasetClient requires either queryBuilder or backend.`
- `createDatasetClient({ queryBuilder: db })` → ok.
**Pass:** error text matches; the builder form constructs a client.

### D1.3 — Connectivity smoke
`await analytics.execute(revenue, { dimensions: ['country'] }, { runtime: { tenant: { scope: 'all' } } })` returns rows. If it fails, fix ClickHouse/env before continuing.

---

## 2. Dimensions (`dimensions.mdx`)

All ClickHouse-backed. Use `{ runtime: { tenant: { scope: 'all' } } }` unless a tenant is specified.

### D2.1 — Helper types
Define a scratch dataset using each of `dimension.string/number/boolean/timestamp`. **Pass:** all construct without error.

### D2.2 — Column mapping
`execute(Orders, { dimensions: ['tenantId'], measures: ['revenue'] }, allTenants)` →
- `toSQL` references `tenant_id`, not `tenantId`
- rows: t1 = 180, t2 = 200.

### D2.3 — SQL-backed dimension (`countryUpper`)
`toSQL` for `dimensions: ['countryUpper']` contains `upper(country)`; executes (US/UK/CA uppercased). Record whether a schema-compat **warning** is emitted (docs: complex SQL only warns).

### D2.4 — `groupable: false`
`email` is `groupable: false`. Run `execute(Orders, { dimensions: ['email'], measures: ['revenue'] }, allTenants)` and **record** whether it's rejected or allowed (docs say `groupable` "records intended behavior" — note actual enforcement).

### D2.5 — `filterable` default + `filterable:false`
Add a scratch dimension with `filterable: false`; confirm `validate` rejects a filter on it. Default dimensions accept filters.

### D2.6 — Labels/descriptions are metadata only
`toSQL` is byte-identical whether or not `label`/`description` are set. (They surface in schema introspection — tested via the MCP/serve specs.)

---

## 3. Measures (`measures.mdx`)

Query each measure with no dimensions (one aggregate row), tenant `{ scope: 'all' }`, and assert exact values from §0.4:

### D3.1 — All aggregation helpers
- `revenue` = 380, `orderCount` = 4, `uniqueCountries` = 3, `avgAmount` = 95, `minAmount` = 30, `maxAmount` = 200.

### D3.2 — Filtered measure
`completedRevenue` = 350.

### D3.3 — SQL-backed measure (builder path)
`taxedRevenue`: `toSQL` contains `sum(amount * 1.2)`; executes = 456. (Rejection on a generic semantic backend is cross-checked in §12.)

### D3.4 — Measure field mapping through a dimension
`uniqueCustomers` (= `countDistinct('customerId')`): `toSQL` counts distinct `customer_id`; executes = 3.

---

## 4. Metrics (`metrics.mdx`)

### D4.1 — Base metric execution
`execute(revenue, { dimensions: ['country'] }, allTenants)` → US 150, UK 30, CA 200.

### D4.2 — Metric inherits measure label
`orderCount` metric omits `label`; confirm it inherits from the measure (inspect via `validate`/describe surfaces, or MCP `get_dataset_schema`). Record.

### D4.3 — Derived metric (`averageOrderValue`)
`execute(averageOrderValue, { dimensions: ['country'] }, allTenants)` → US 75, UK 30, CA 200. Inspect `toSQL` — expect a CTE/formula structure dividing the two aggregates.

### D4.4 — Derived-metric guardrails (negative)
- `uses` referencing a metric from a **different** dataset → throws at definition time.
- Deriving from another **derived** metric → throws.

### D4.5 — Formula helpers
Build scratch derived metrics using `multiply`, `add`, `subtract`, `coalesce`, `round` (e.g. `round(divide(revenue, nullIfZero(orderCount)))`). Confirm each plans + executes against ClickHouse.

### D4.6 — `orderBy` on a metric
`execute(revenue, { dimensions: ['country'], orderBy: [desc('revenue')], limit: 2 }, allTenants)` → CA 200, US 150. Confirm `[{ field:'revenue', direction:'desc' }]` object form is equivalent.

---

## 5. Filters & ordering (`filters.mdx`)

### D5.1 — Each filter helper shape
`eq('status','completed')` deep-equals `{ field:'status', operator:'eq', value:'completed' }`. Spot-check `gt`, `inList`, `between`, `like`, `notInList`.

### D5.2 — Filters in metric queries
`execute(revenue, { dimensions:['country'], filters:[eq('status','completed'), gte('amount',100)] }, allTenants)` → US 100, CA 200 (the 50 row excluded).

### D5.3 — Filters in dataset queries
`execute(Orders, { dimensions:['country','status'], measures:['revenue','orderCount'], filters:[eq('status','completed')] }, allTenants)` → assert rows (US: revenue 150/count 2; CA: 200/1).

### D5.4 — Restricted filter contract
`filters.status` allows only `['eq','neq','in','notIn']`.
- `validate(revenue, { filters:[eq('status','x')] })` → valid.
- `validate(revenue, { filters:[like('status','%x%')] })` → **invalid** (operator not allowed). Record error.
- A filter on `country` (not in the `filters` map) — record whether allowed (docs imply `status` becomes the only exposed filter field).

### D5.5 — Order helpers
`orderBy: [desc('revenue'), asc('country')]` validates + orders correctly; `toSQL` shows `ORDER BY ... DESC, ... ASC`.

---

## 6. Execution surface (`execution.mdx`)

### D6.1 — `validate` returns data, not throws
`analytics.validate(revenue, { dimensions: ['country'] })` → `{ valid: true, errors: [] }`. Unknown dimension `nope` → `{ valid:false, errors:[...] }` **without throwing**.

### D6.2 — `toSQL` inspects + validates first
`analytics.toSQL(revenue, { dimensions:['country'], orderBy:[desc('revenue')], limit:10 })` contains `sum(amount)`, `GROUP BY`, `ORDER BY ... DESC`, `LIMIT`. Invalid query → `toSQL` **throws** the same validation errors. Dump all scenario SQL into `sql/`.

### D6.3 — `execute` returns rows + meta
`const r = await analytics.execute(revenue, { dimensions:['country'], limit:25 }, allTenants)`:
- `r.data` array; `r.meta?.sql`, `r.meta?.timingMs`, `r.meta?.rowCount` present
- `r.meta?.pagination` present because `limit` set: `{ limit:25, offset:0, hasMore:false }` (only 3 country rows).

### D6.4 — Pagination over-fetch / `hasMore`
`execute(revenue, { dimensions:['country'], limit:2 }, allTenants)` → 2 rows, `hasMore: true`. Confirm `meta.sql` shows an over-fetch (`LIMIT 3` / limit+1) and **no** separate COUNT query.

### D6.5 — Dataset (ad hoc) execution
`execute(Orders, { dimensions:['country','status'], measures:['revenue','orderCount'] }, allTenants)` returns combined rows; `meta.sql` selects both aggregations.

---

## 7. Time grains (`time-grains.mdx`)

### D7.1 — `.by(grain)` requires `timeKey`
`revenue.by('month')` works (Orders has `timeKey`). A scratch dataset **without** `timeKey` → `.by(...)`/execution rejected. Record.

### D7.2 — Each supported grain
For `day`, `week`, `month`, `quarter`, `year`: `analytics.toSQL(revenue.by(grain), { dimensions:['country'] })` contains the grain bucketing on `created_at` (cross-check `GRAIN_FUNCTIONS`).
- ClickHouse execute for `month` (tenant `{ scope:'all' }`, no extra dims): 2026-01 = 150, 2026-02 = 230.

### D7.3 — Unsupported grain
`revenue.by('hour' as any)` → rejected. Record message.

### D7.4 — `timeKey` is not a selectable dimension by itself
Selecting raw `created_at` fails unless the `createdAt` timestamp dimension (mapped to `created_at`) is used.

---

## 8. Multi-tenancy (`multi-tenancy.mdx`) — fail-closed

Orders has `tenantKey: 'tenant_id'`.

### D8.1 — Missing tenant context is rejected
`await analytics.execute(revenue)` → throws `Dataset "orders" requires runtime tenant scoping.`

### D8.2 — Single tenant injects predicate
`execute(revenue, { dimensions:['country'] }, { runtime: { tenant: 't1' } })`:
- `toSQL` contains `tenant_id = 't1'` (or parameterized equivalent)
- rows: US 150, UK 30 (CA excluded).

### D8.3 — Tenant runtime value forms
- `tenant: 't1'` and `tenant: { id: 't1' }` → identical (t1 rows).
- `tenant: { in: ['t1','t2'] }` → all rows (US 150, UK 30, CA 200).
- `tenant: { scope: 'all' }` → all rows; trusted-only.

### D8.4 — Explicit tenant filter is rejected
`execute(revenue, { filters:[eq('tenantId','t1')] }, { runtime: { tenant: 't1' } })` → throws `Cannot filter on tenant field "tenantId" when runtime tenancy enforcement is active.`

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

The docs note dataset execution is currently same-dataset, but `belongsTo`/`hasMany`/`hasOne` exist and surface in schema introspection.

### D10.1 — Define relationships
Add a `relationships` block to a scratch dataset using `belongsTo`/`hasMany`/`hasOne`. **Pass:** dataset constructs; relationship metadata is present on the instance (inspect, or verify later via MCP `get_dataset_schema`). Record whether any execution path consumes them yet.

---

## 11. End-to-end inspectable artifact

**Goal:** leave a readable app + SQL dumps + a green live test run.
1. `src/sql-dump.ts` iterates every scenario target (metric/dataset/grained) and writes `analytics.toSQL(...)` to `sql/<name>.sql`. Run it; keep the `sql/` folder — these are human-inspectable generated queries (sums, group-bys, time grains, tenant predicates, filtered/SQL-backed measures).
2. `tests/clickhouse.test.ts` encodes the exact assertions above (§3, §4, §5.2–5.3, §6, §7.2, §8) against your seeded ClickHouse. Run `npx vitest run` → all green with the exact numbers from §0.4.

**Pass:** `sql/` contains correct SQL; live tests pass with the documented values.

---

## 12. Optional: in-memory backend cross-check

Only to verify backend-specific behavior and offer a DB-free smoke path. Build
`createInMemoryBackend(tables)` with rows mirroring §0.4, then:

### D12.1 — Same numbers, no DB
Re-run a subset of §3/§4 assertions against the in-memory client; results match the ClickHouse numbers. (Sanity that semantics are backend-consistent.)

### D12.2 — SQL-backed measures rejected by generic semantic backend
`execute(..., 'taxedRevenue', ...)` on the **in-memory** client → **throws** (docs: generic semantic plans reject SQL-backed measures because cross-backend adapters can't assume SQL syntax). Record the message. This is the one place the backend choice changes behavior.

### D12.3 — Backend/builder guard
A backend-only client calling a builder-only path → throws `This dataset client was created with a semantic backend, not a query builder.`

---

## 13. Reporting template
Per scenario: target + query JSON, expected vs actual (numbers or SQL snippet), PASS/FAIL, notes. Attach the `sql/` dump and the vitest output. Flag any deviation, and confirm/deny Appendix A.

---

## Appendix A — Things to confirm against docs
- **CLI `generate:datasets` example (FIXED).** The CLI's success message previously printed `createDatasetClient({ backend: createBackend({...}) })` with `import { createBackend } from '@hypequery/clickhouse'` — but `createBackend` is only exported from the `@hypequery/clickhouse/datasets` **subpath**, not the root, so that import failed. The message now uses the documented `createQueryBuilder` + `createDatasetClient({ queryBuilder: db })` form. (`createBackend` still exists at `@hypequery/clickhouse/datasets` if you specifically want the semantic-backend path.)
- **`groupable` enforcement:** docs say `groupable: false` "records intended behavior" rather than hard-blocking. Record whether selecting a `groupable:false` dimension is actually rejected (D2.4).
- **Restricted-filter map scope:** docs imply adding a `filters` map makes the listed field the only exposed filter field. Confirm filters on other dimensions are then rejected (D5.4).
- **SQL-backed measures on generic semantic backend:** confirm rejection on the in-memory backend but success on the ClickHouse builder (D3.3 vs D12.2).
- **Pagination metadata:** confirm `meta.pagination` only appears when `limit` is set and that `hasMore` uses over-fetch, not a COUNT (D6.3–D6.4).
- **Relationships:** confirm whether any execution path consumes `belongsTo`/`hasMany`/`hasOne` yet, or they're introspection-only for now (D10.1).
