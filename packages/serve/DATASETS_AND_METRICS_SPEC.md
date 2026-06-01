# Semantic Datasets & Metrics API — Implementation Spec v3

> **Status:** Historical draft v3. The current implementation now routes serve semantic endpoints through `semanticExecutor` / `createDatasetClient`; older `MetricExecutor` and `queryBuilder` sections below are retained as design history and should not be treated as the current public DX.
> **Prerequisite:** The `createAPI()` / transport-separation PR.

## Docs Notes

When these packages are ready for public docs, the first docs pass should focus on the implemented surface only:

- `@hypequery/datasets`
  - dataset definition
  - measures
  - filtered measures
  - metrics
  - derived metrics
  - `.by(grain)`
  - runtime tenancy shape
  - `SemanticExecutor`
  - intentional root exports only; serve-only helpers should stay under `@hypequery/datasets/internal`
- `@hypequery/serve`
  - generated metric endpoints
  - generated dataset endpoints
  - auth / tenant runtime ownership
  - `X-Include-Meta` behavior
- `@hypequery/schema`
  - schema ↔ datasets compatibility checks
  - migration-plan integration via `semanticCompatibility`

Docs should explicitly avoid presenting these as shipped until they are actually implemented:

- `dataset.query(...)` as a public semantic API
- relationship-aware execution
- `.rolling(...)`
- `.compare(...)`
- deep SQL compatibility analysis beyond the current v1 checker

Docs should also preserve the package ownership boundary:

- `datasets` owns semantic planning
- `serve` owns runtime delivery and policy
- `schema` owns physical truth and compatibility checks
- `clickhouse` owns relational query construction and execution

---

## 1. Design Philosophy

Hypequery's analytics layer is built on four primitives:

| Layer | Purpose | Feel |
|-------|---------|------|
| **Dataset** | Semantic model over a physical source | Dimensions, measures, filtered measures, metrics, tenant/time semantics |
| **Metric** | Canonical reusable business values | Derived from dataset measures and formulas |
| **Schema** | Physical warehouse truth | Tables, views, snapshots, diffs, migration planning, semantic compatibility |
| **Serve** | Execution/runtime surface | Auth, tenancy, caching, transport, OpenAPI |

Key departures from the previous spec:
- **One semantic surface.** There is no separate `defineModel` API. `dataset(...)` is the semantic model.
- **Datasets use dimensions and measures.** `field` remains a compatibility alias of `dimension`, not a separate concept.
- **Serve generation is optional.** The semantic layer is useful in-process even without generated HTTP endpoints.
- **Datasets own semantic planning.** Serve should consume semantic planning and execution helpers from `@hypequery/datasets`, not re-implement planner behavior locally.
- **Schema is the physical layer.** `@hypequery/schema` owns snapshots, diffs, migration planning, and schema ↔ datasets compatibility checks.
- **React consumes real endpoint paths.** Client config now carries `method` and `path`, so generated metric and dataset endpoints can be consumed by hooks without flat-route assumptions.
- **No `defineDashboard`.** Dashboard composition is a UI concern, not a server primitive.
- **No materialization.** Out of scope — too much DDL lifecycle complexity.
- **`query(...)` stays as-is.** Existing query-builder and serve query endpoints remain available unchanged.
- **`dataset.query(...)` is not part of the public semantic API.** Dataset endpoints exist in serve, but the public semantic surface is dataset definition + metrics, not public dataset query refs.

---

## 2. Architecture Overview

```
┌──────────────────────────────────────────────────────────────┐
│  serve({                                                      │
│    metrics: { totalRevenue, avgOrderValue, revenueGrowthMoM } │
│    datasets: { orders: Orders }                               │
│    queries: { recentOrders: query.query(async () => ...) }    │
│    auth, caching, tenant                                      │
│  })                                                           │
│                                                               │
│  ┌──────────────────────┐   ┌────────────────────────────┐   │
│  │  Queries (unchanged) │   │  Semantic datasets         │   │
│  │  query: fn()         │   │                            │   │
│  │  ↓                   │   │  Dataset                   │   │
│  │  QueryBuilder        │   │   ├─ dimensions            │   │
│  │  ↓                   │   │   ├─ measures              │   │
│  │  adapter.execute()   │   │   ├─ filtered measures     │   │
│  │                      │   │   ├─ relationships         │   │
│  │                      │   │   └─ dataset.metric(...)   │   │
│  └──────────────────────┘   └────────────────────────────┘   │
│                                                               │
│  MetricExecutor / dataset-query helpers ──→ QueryBuilder      │
│  ServeHandler ──→ transports (serve, node, fetch)             │
└──────────────────────────────────────────────────────────────┘
```

Current ownership boundary:

- `@hypequery/datasets` owns semantic planning, validation, and execution composition
- `@hypequery/clickhouse` owns relational query construction and execution
- `@hypequery/serve` owns runtime concerns like auth, tenancy, caching, and transport
- `@hypequery/schema` owns physical-schema truth and compatibility with datasets

---

## 3. API Design

### 3.1 Dataset Definition

A dataset is the semantic model. It defines the public dimensions, reusable measures, allowed filters, relationships, and tenant/time semantics for one logical source.

```ts
import { dataset, dimension, measure, belongsTo } from '@hypequery/serve';

const Customers = dataset("customers", {
  source: "customers",
  tenantKey: "tenant_id",

  dimensions: {
    id: dimension.string(),
    country: dimension.string(),
    createdAt: dimension.timestamp({ column: "created_at" }),
  },

  measures: {
    customerCount: measure.count("id"),
  },
});

const Orders = dataset("orders", {
  source: "orders",
  tenantKey: "tenant_id",
  timeKey: "created_at",

  dimensions: {
    id: dimension.string(),
    customerId: dimension.string({ column: "customer_id" }),
    country: dimension.string({ label: "Country" }),
    status: dimension.string({ label: "Order Status" }),
    createdAt: dimension.timestamp({ column: "created_at", label: "Created At" }),
  },

  measures: {
    revenue: measure.sum("amount", { label: "Revenue" }),
    orderCount: measure.count("id", { label: "Orders" }),
    avgAmount: measure.avg("amount"),
  },

  filters: {
    status: { field: "status" },
    country: { field: "country" },
  },

  relationships: {
    customer: belongsTo(() => Customers, {
      from: "customerId",
      to: "id",
    }),
  },
});
```

**Design notes:**

- `source` is the physical table name. The dataset name (first arg) is the logical name.
- `tenantKey` declares the dataset tenant column. Serve owns tenant identity at runtime and datasets uses `tenantKey` to apply semantic tenant filtering.
- `timeKey` declares the physical time column used by `.by(grain)` and dataset endpoint queries with `by`.
- `dimension.*()` functions define the queryable/groupable public dimensions.
- `measure.*()` functions define canonical aggregations that metrics and dataset endpoint queries reuse.
- `filters` lets you explicitly constrain and name the filter surface. If omitted, filterable dimensions are exposed by default.
- Relationships use lazy thunks (`() => Customers`) to avoid circular import issues.
- For this release, relationships are semantic model metadata only. They are stored on the dataset and available for introspection, but current query execution does not yet resolve joined dimensions, joined measures, or cross-dataset metrics.
- Filtered measures are supported and are part of the stable pre-release surface.

**Dimension helpers:**

```ts
dimension.string(opts?)
dimension.number(opts?)
dimension.boolean(opts?)
dimension.timestamp(opts?)

// Common options:
interface DimensionOptions {
  label?: string;
  description?: string;
  column?: string;
  sql?: string;
  filterable?: boolean;
  groupable?: boolean;
}
```

**Measure helpers:**

```ts
measure.sum(field, opts?)
measure.count(field, opts?)
measure.countDistinct(field, opts?)
measure.avg(field, opts?)
measure.min(field, opts?)
measure.max(field, opts?)
```

**Relationship types:**

```ts
belongsTo(() => Target, { from, to })  // many-to-one (FK on this table)
hasMany(() => Target, { from, to })    // one-to-many (FK on target table)
hasOne(() => Target, { from, to })     // one-to-one (FK on target table)
```

Relationship note for this release:
- Defining relationships is supported and stable.
- Query execution is still same-dataset only.
- Public examples should not imply path traversal like `customer.country` works yet.

### 3.2 Base Metrics

Base metrics are dataset-attached reusable business values. They are typically defined in terms of named measures.

```ts
const totalRevenue = Orders.metric("totalRevenue", {
  measure: "revenue",
  label: "Total Revenue",
  description: "Sum of all order amounts",
});

const orderCount = Orders.metric("orderCount", {
  measure: "orderCount",
});
```

Direct aggregation specs are still supported when you want an inline metric:

```ts
const totalRevenue = Orders.metric("totalRevenue", {
  value: sum("amount"),
});
```

This direct `value:` form is legacy/speculative and should not be treated as the primary public path. The implemented pre-release API centers on dataset measures:

```ts
const totalRevenue = Orders.metric("totalRevenue", {
  measure: "revenue",
});
```

`Orders.metric()` returns a reusable `MetricRef` with `.by(grain)` and `.contract()`.

### 3.3 Derived Metrics (Same-Dataset)

Derived metrics compose other metrics on the same dataset using formula functions.

```ts
import { divide, nullIfZero, subtract } from '@hypequery/serve';

const avgOrderValue = Orders.metric("avgOrderValue", {
  uses: {
    revenue: totalRevenue,
    orders: orderCount,
  },
  formula: ({ revenue, orders }) =>
    divide(revenue, nullIfZero(orders)),
});
```

**Formula helpers (symbolic, not raw SQL):**

```ts
// Arithmetic
divide(a, b): FormulaExpr
multiply(a, b): FormulaExpr
subtract(a, b): FormulaExpr
add(a, b): FormulaExpr

// Null handling
nullIfZero(a): FormulaExpr
coalesce(a, fallback): FormulaExpr

// Rounding
round(a, decimals?): FormulaExpr
floor(a): FormulaExpr
ceil(a): FormulaExpr
```

**SQL escape hatch via tagged template:**

For formulas that go beyond the built-in helpers, use `sql` tagged templates. Interpolated metric references are still type-checked and resolved symbolically — they are not string-concatenated.

```ts
const marginPercent = Orders.metric("marginPercent", {
  uses: {
    revenue: totalRevenue,
    cost: totalCost,
  },
  formula: ({ revenue, cost }) =>
    sql`ROUND((${revenue} - ${cost}) / NULLIF(${revenue}, 0) * 100, 2)`,
});
```

**Execution model for derived metrics:**

The executor wraps the base aggregations in a CTE and computes derived formulas in an outer SELECT:

```sql
WITH base AS (
  SELECT
    country,
    SUM(amount) AS totalRevenue,
    COUNT(id) AS orderCount
  FROM orders
  WHERE tenant_id = ?
  GROUP BY country
)
SELECT
  country,
  totalRevenue,
  orderCount,
  totalRevenue / NULLIF(orderCount, 0) AS avgOrderValue
FROM base
```

### 3.4 Time Operators

Time semantics are operators on metrics, not a separate metric type. They require the dataset to have a `timeKey` defined.

**Graining — aggregate by time bucket:**

```ts
const dailyRevenue = totalRevenue.by("day");
const weeklyRevenue = totalRevenue.by("week");
const monthlyRevenue = totalRevenue.by("month");
```

`.by(grain)` returns a `GrainedMetric` — a new metric type whose contract includes a time dimension. The generated SQL uses the adapter's date-truncation function (e.g., `toStartOfDay()` for ClickHouse, `DATE_TRUNC('day', ...)` for Postgres).

**Return type changes:**

```ts
// Base metric result: { totalRevenue: number }
// Grained metric result: { period: string, totalRevenue: number }
```

The `period` field name is fixed by convention. The value is an ISO date string truncated to the grain.

**Rolling windows:**

```ts
const rolling7dRevenue = totalRevenue.rolling("7d");
const rolling30dOrders = orderCount.rolling("30d");
```

Rolling windows generate a window function or self-join depending on the adapter dialect.

**Previous period comparison:**

```ts
import { previousPeriod } from '@hypequery/serve';

const revenueGrowthMoM = monthlyRevenue.compare(previousPeriod("month"), {
  formula: ({ current, previous }) =>
    divide(subtract(current, previous), nullIfZero(previous)),
});
```

`.compare()` generates a self-join or `LAG()` window function that aligns the current period with the comparison period. The `formula` receives symbolic handles to the current and previous values.

**Generated SQL (ClickHouse example):**

```sql
SELECT
  toStartOfMonth(created_at) AS period,
  SUM(amount) AS current_totalRevenue,
  lagInFrame(SUM(amount)) OVER (ORDER BY toStartOfMonth(created_at)) AS previous_totalRevenue,
  (current_totalRevenue - previous_totalRevenue)
    / NULLIF(previous_totalRevenue, 0) AS revenueGrowthMoM
FROM orders
WHERE tenant_id = ?
GROUP BY period
ORDER BY period
```

**Implementation target:** SQL-level, with the `DatabaseAdapter` handling dialect differences. Application-level fallback is acceptable for edge cases during initial implementation but should not be the conceptual model.

**Scope:**

| Operator | Ship now | Ship next |
|----------|----------|-----------|
| `.by(grain)` | Yes | — |
| `.rolling(window)` | — | Yes |
| `.compare(previousPeriod)` | — | Yes |

Only `.by(grain)` is implemented in the current pre-release surface. Rolling windows and previous-period comparison remain future design targets and should not be presented as shipped behavior yet.

### 3.5 Metric Filtering at Query Time

Metrics define canonical values. Consumers can narrow them at query time by specifying dimensions and filters:

```ts
// Server-side (in-process)
const result = await executor.run(totalRevenue, {
  dimensions: ["country", "status"],
  filters: [{ field: "status", operator: "eq", value: "completed" }],
  orderBy: [{ field: "totalRevenue", direction: "desc" }],
  limit: 100,
});

// Client-side (via useMetric)
const { data } = useMetric(totalRevenue, {
  dimensions: ["country"],
  filters: { country: "US" },
  by: "month",
});
```

The available dimensions and filters are constrained by the metric's dataset fields and declared filter surface. Runtime validation happens before SQL generation. When runtime tenancy is active, explicit tenant filters are rejected instead of being duplicated.

### 3.6 Contracts

Every metric exposes its contract — a serializable description of what the metric is, what it accepts, and what it returns. This powers typed clients, OpenAPI generation, and AI/MCP discoverability.

```ts
totalRevenue.contract();
// Returns:
{
  kind: "metric",
  name: "totalRevenue",
  dataset: "orders",
  valueType: "number",
  label: "Total Revenue",
  description: "Sum of all order amounts",
  dimensions: ["id", "customerId", "country", "status", "createdAt"],
  filters: ["id", "customerId", "country", "status", "createdAt"],
  grains: ["day", "week", "month", "quarter", "year"],
  tenantScoped: true,
}

avgOrderValue.contract();
// Returns:
{
  kind: "derived_metric",
  name: "avgOrderValue",
  dataset: "orders",
  valueType: "number",
  requires: ["totalRevenue", "orderCount"],
  // ... same dimension/filter/grain fields
}
```

Contracts are generated at definition time (no runtime cost per query). They are used by:
- `serve()` to generate OpenAPI schemas for metric endpoints
- `useMetric()` to type-check dimension/filter arguments
- Future AI/MCP tools to discover available metrics
- `metric.contract()` for programmatic inspection

### 3.7 Serve Integration

`serve()` consumes metrics and queries as separate categories. Metrics get auto-generated endpoints; queries remain manually defined.

```ts
import { serve, createAPI } from '@hypequery/serve';

const api = createAPI({
  // Metrics: auto-generated endpoints
  metrics: {
    totalRevenue,
    orderCount,
    avgOrderValue,
    revenueGrowthMoM,
  },

  // Queries: manually defined (existing API, unchanged)
  queries: {
    recentOrders: query
      .output(z.array(OrderSchema))
      .cache(60_000)
      .query(async ({ ctx }) => {
        return hypequery
          .table('orders')
          .select(['id', 'customerId', 'amount', 'createdAt'])
          .where('status', 'eq', 'completed')
          .orderBy('createdAt', 'desc')
          .limit(50)
          .execute();
      }),
  },

  // Infrastructure
  auth: authHandler(),
  tenant: {
    extract: (auth) => auth.tenantId,
    required: true,
    mode: 'auto-inject',
  },
  caching: cacheConfig(),
  queryLogging: true,
});

serve(api, { port: 3000 });
```

**Auto-generated metric endpoints:**

```
POST /api/metrics/totalRevenue
  Body: { dimensions?, filters?, orderBy?, limit?, grain? }
  Response: { data: [...], meta: { sql?, timingMs?, cache? } }

POST /api/metrics/avgOrderValue
  Body: { dimensions?, filters?, orderBy?, limit? }
  Response: { data: [...], meta: { ... } }
```

Each metric endpoint:
- Validates dimensions/filters against the metric's contract
- Applies serve-owned tenant runtime and rejects explicit tenant filters when runtime tenancy is active
- Inherits auth from global `auth` config
- Respects `caching` config (metric config is serializable → natural cache key)
- Returns `meta` only when explicitly opted in (via header or config)

Dataset endpoints are also supported in serve, but they execute query payloads directly against a dataset definition. They do not rely on a public `dataset.query(...)` API.

**Per-metric overrides:**

```ts
metrics: {
  totalRevenue: {
    metric: totalRevenue,
    auth: requireRole('analyst'),
    cache: 300_000,  // 5 min cache for this metric
  },
  orderCount,  // shorthand: no overrides
},
```

### 3.8 Client API (`useMetric`)

The React client consumes metrics by name, with typed dimensions and filters.

```ts
import { createHooks } from '@hypequery/react';

const { useMetric, useQuery } = createHooks<typeof api>({
  baseUrl: '/api',
});

// Basic metric query
const { data, isLoading, error } = useMetric("totalRevenue", {
  dimensions: ["country"],
  filters: { status: "completed" },
  orderBy: [{ field: "totalRevenue", direction: "desc" }],
  limit: 10,
});
// data: Array<{ country: string, totalRevenue: number }>

// With time grain
const { data: monthly } = useMetric("totalRevenue", {
  by: "month",
  filters: { country: "US" },
});
// monthly: Array<{ period: string, totalRevenue: number }>

// Existing queries work unchanged
const { data: orders } = useQuery("recentOrders");
```

**Type safety:**
- `dimensions` autocompletes to fields on the metric's dataset
- `filters` keys autocomplete to field names
- `by` autocompletes to valid time grains
- Return type is inferred from selected dimensions + metric value type

**Built on TanStack Query** (same as existing `useQuery`):
- `staleTime`, `gcTime`, `refetchInterval`, `enabled` — all standard options work
- Cache key is derived from metric name + query params

### 3.9 Runtime Result Shape

Internal execution always produces:

```ts
interface MetricResult<T> {
  data: T[];
  meta: {
    cache?: { hit: boolean; key?: string };
    timingMs?: number;
    traceId?: string;
    sql?: string;
    tenant?: string;
  };
}
```

External behavior depends on configuration:

| Mode | Response shape |
|------|---------------|
| Default | `{ data: [...] }` — meta excluded |
| `X-Include-Meta: true` header | `{ data: [...], meta: { ... } }` |
| `envelope: true` in serve config | Always includes meta |
| In-process `executor.run()` | Always returns full `MetricResult` |

---

## 4. Execution Engine

### 4.1 Key Decision: Delegate to QueryBuilder

The semantic layer does **not** generate SQL strings directly as its source of truth. `MetricExecutor` and the shared dataset-query helpers compose the existing `@hypequery/clickhouse` QueryBuilder programmatically. This gives us parameterized queries, dialect handling, CTE support, caching, and logging for free.

The QueryBuilder exposes everything we need:
- `.table(name)` — start from a physical table
- `.select([...])` — dimension columns
- `.sum(col, alias)`, `.count(col, alias)`, `.avg(col, alias)`, `.min()`, `.max()` — aggregations
- `.where(col, op, value)` — filters (parameterized automatically)
- `.groupBy([...])` — GROUP BY from dimensions
- `.groupByTimeInterval(col, interval, method)` — time graining (`toStartOfMonth`, etc.)
- `.orderBy(col, dir)`, `.limit(n)` — modifiers
- `.leftJoin(table)` / `.withRelation(name)` — relationships via `JoinRelationships`
- `.withCTE(alias, subqueryBuilder)` — CTE wrapping for derived metrics
- `.toSQL()` / `.toSQLWithParams()` — SQL output without executing
- `.execute()` — execute with logging, caching, and parameterization

The QueryBuilder is heavily generic-typed for user-facing fluent chains. The semantic execution layer works with the duck-typed builder protocol internally — type safety lives at the dataset/metric definition and contract boundary, not inside the executor.

### 4.2 MetricExecutor

```ts
class MetricExecutor {
  private qb: ReturnType<typeof createQueryBuilder<any>>;

  constructor(options: {
    queryBuilder: ReturnType<typeof createQueryBuilder<any>>;
    datasets: DatasetRegistry;
  });

  /**
   * Execute a metric query. Builds a QueryBuilder chain from the metric
   * definition, applies filters/dimensions/tenant context, and executes.
   */
  run<T>(
    metric: MetricRef<any, any, any>,
    query: MetricQuery,
    context?: ExecutionContext,
  ): Promise<MetricResult<T>>;

  /**
   * Generate SQL without executing (for debugging/logging).
   * Delegates to QueryBuilder.toSQL().
   */
  toSQL(
    metric: MetricRef<any, any, any>,
    query: MetricQuery,
  ): string;

  /**
   * Validate a metric query against the metric's contract.
   */
  validate(
    metric: MetricRef<any, any, any>,
    query: MetricQuery,
  ): ValidationResult;
}
```

Related implemented internal helper surface:

```ts
// @hypequery/datasets/internal
validateDatasetQuery(dataset, query, context?)
buildDatasetQueryBuilder(dataset, query, options)
runDatasetQuery(dataset, query, options)
```

These helpers are for package integration, primarily serve-backed dataset endpoints. They should not be documented as the user-facing datasets API unless we deliberately promote them later.

### 4.3 How MetricExecutor Builds Queries

The executor translates metric definitions into QueryBuilder calls. Here's the
mapping for each case:

**Base metrics — `.table().select().sum().where().groupBy().execute()`**

```ts
// Metric: totalRevenue = sum("amount") on Orders dataset
// Query:  dimensions: ["country"], filters: { status: "completed" }

async run(metric, query, context) {
  let builder = this.qb
    .table(metric.dataset.source)          // .table("orders")
    .select(query.dimensions)              // .select(["country"])
    .sum("amount", "totalRevenue");        // .sum("amount", "totalRevenue")

  // Apply runtime tenant when present
  if (context?.runtime?.tenant && dataset.tenantKey) {
    builder = builder.where(dataset.tenantKey, "eq", context.runtime.tenant.id);
  }

  // User filters
  for (const filter of query.filters ?? []) {
    builder = builder.where(filter.field, filter.operator, filter.value);
  }

  // Order + limit
  for (const ord of query.orderBy ?? []) {
    builder = builder.orderBy(ord.field, ord.direction);
  }
  if (query.limit) builder = builder.limit(query.limit);

  return { data: await builder.execute(), meta: { sql: builder.toSQL() } };
}
```

Generated SQL (via QueryBuilder):
```sql
SELECT
  country,
  SUM(amount) AS totalRevenue
FROM orders
WHERE tenant_id = ?
  AND status = ?
GROUP BY country
ORDER BY totalRevenue DESC
LIMIT 100
```

**Derived metrics — `.withCTE()` for base aggregations + outer formula**

```ts
// Metric: avgOrderValue = divide(totalRevenue, orderCount)
// The executor collects all base metrics, builds a CTE, then wraps with formula.

const baseBuilder = this.qb
  .table("orders")
  .select(query.dimensions)
  .sum("amount", "totalRevenue")
  .count("id", "orderCount");
  // + where, groupBy (same as above)

const outerBuilder = this.qb
  .table("base")                           // FROM base (the CTE)
  .withCTE("base", baseBuilder)            // WITH base AS (SELECT ...)
  .select([
    ...query.dimensions,
    rawAs("totalRevenue / NULLIF(orderCount, 0)", "avgOrderValue"),
  ]);

return { data: await outerBuilder.execute() };
```

Generated SQL:
```sql
WITH base AS (
  SELECT
    country,
    SUM(amount) AS totalRevenue,
    COUNT(id) AS orderCount
  FROM orders
  WHERE tenant_id = ?
  GROUP BY country
)
SELECT
  country,
  totalRevenue / NULLIF(orderCount, 0) AS avgOrderValue
FROM base
```

**Grained metrics — `.groupByTimeInterval()` from existing QueryBuilder**

```ts
// Metric: monthlyRevenue = totalRevenue.by("month")

const grainMethod = {
  day: "toStartOfDay",
  week: "toStartOfWeek",
  month: "toStartOfMonth",
  quarter: "toStartOfQuarter",
  year: "toStartOfYear",
} as const;

builder = this.qb
  .table("orders")
  .select([
    rawAs(`${grainMethod[grain]}(${dataset.timeKey})`, "period"),
  ])
  .sum("amount", "totalRevenue")
  .groupByTimeInterval(dataset.timeKey, `1 ${grain}`, grainMethod[grain]);
```

Generated SQL (ClickHouse):
```sql
SELECT
  toStartOfMonth(created_at) AS period,
  SUM(amount) AS totalRevenue
FROM orders
WHERE tenant_id = ?
GROUP BY period
ORDER BY period
```

**Future: cross-relationship metrics and joined semantic queries**

This is not part of the shipped execution surface in this release. Relationship-aware query planning and joined metric execution are a follow-on milestone.

```ts
// Query includes a dimension from a related dataset (e.g., customer.country)

const relationships = JoinRelationships.create();
relationships.define("orders_to_customers", {
  from: "orders", to: "customers",
  leftColumn: "customer_id", rightColumn: "id",
  type: "LEFT",
});

builder = this.qb
  .table("orders")
  .leftJoin("customers", "customer_id", "id")
  .select([rawAs("customers.country", "country")])
  .sum("orders.amount", "totalRevenue");
```

Generated SQL:
```sql
SELECT
  customers.country AS country,
  SUM(orders.amount) AS totalRevenue
FROM orders
LEFT JOIN customers ON orders.customer_id = customers.id
WHERE orders.tenant_id = ?
GROUP BY customers.country
```

### 4.4 What We Get for Free from QueryBuilder

| Concern | How QueryBuilder Handles It |
|---------|---------------------------|
| **Parameterization** | `.where()` auto-parameterizes values — no SQL injection risk |
| **Dialect** | `ClickHouseDialect` compiles `QueryConfig` → SQL with CH-specific syntax |
| **Time functions** | `.groupByTimeInterval()` uses `toStartOfDay`, `toStartOfMonth`, etc. |
| **CTEs** | `.withCTE(alias, subqueryBuilder)` — perfect for derived metrics |
| **Caching** | `.cache({ ttlMs })` integrates with the existing cache system |
| **Logging** | `ExecutorFeature.execute()` logs query timing, row count, errors |
| **Raw expressions** | `raw()`, `rawAs()`, `selectExpr()` for custom SQL in formulas |
| **Streaming** | `.stream()` / `.streamForEach()` available if needed |

### 4.5 Aggregation Mapping

The executor maps metric aggregation specs to QueryBuilder methods:

```ts
function applyAggregation(builder, spec, alias) {
  switch (spec.type) {
    case "sum":            return builder.sum(spec.field, alias);
    case "count":          return builder.count(spec.field, alias);
    case "avg":            return builder.avg(spec.field, alias);
    case "min":            return builder.min(spec.field, alias);
    case "max":            return builder.max(spec.field, alias);
    case "countDistinct":
      return builder.select([
        ...currentSelects,
        rawAs(`COUNT(DISTINCT ${spec.field})`, alias),
      ]);
  }
}
```

Note: `countDistinct` doesn't have a dedicated QueryBuilder method, so we use
`rawAs()` — the field name is validated against the dataset contract before this
point, so it's safe.

---

## 5. Infrastructure Concerns

These are not afterthoughts — they are core to the runtime.

### 5.1 Tenant Isolation

Tenant isolation for metrics and semantic datasets follows the existing Serve tenancy model:

- Serve config declares `tenant.extract` (how to get tenant ID from auth)
- Serve config may declare `tenant.column` for builder-level auto-injection
- Serve passes tenant identity into semantic execution as runtime context
- `mode: 'auto-inject'` scopes the builder; `mode: 'manual'` leaves enforcement to the semantic runtime contract
- **Tenant context is never optional in production** — a missing tenant ID rejects the request

Public semantic runtime shape is intentionally narrow:

```ts
runtime: {
  tenant: {
    id: string
  }
}
```

Public semantic consumers do not provide `tenant.column` or `handledByBuilder`.

### 5.2 Auth & Authorization

Metrics inherit auth from the serve-level config by default. Per-metric overrides are supported:

```ts
metrics: {
  // Inherits global auth
  totalRevenue,

  // Custom auth for sensitive metrics
  profitMargin: {
    metric: profitMargin,
    auth: requireRole('finance'),
  },
},
```

Auth strategies are the same as existing serve auth — `bearerStrategy`, `apiKeyStrategy`, custom strategies. No new auth concepts introduced.

### 5.3 Caching

Metric queries are naturally cacheable because `MetricQuery` is serializable:

```ts
// Cache key = hash(metricName, dimensions, filters, grain, tenantId)
```

Caching config flows through the existing `cacheTtlMs` system:

```ts
const api = createAPI({
  metrics: {
    totalRevenue: {
      metric: totalRevenue,
      cache: 60_000,  // 1 minute
    },
  },
  caching: {
    defaultTtl: 30_000,  // 30s default for all metrics
    adapter: redisCacheAdapter,  // or in-memory
  },
});
```

Cache invalidation is time-based (TTL). No dependency tracking or event-driven invalidation — that's a materialization concern (out of scope).

### 5.4 Query Logging & Observability

Metric execution integrates with the existing `queryLogging` system:

```ts
const api = createAPI({
  queryLogging: true,  // logs metric name, SQL, timing, tenant
  slowQueryThreshold: 5000,  // warn on metrics taking >5s
  hooks: {
    onMetricExecuted: ({ metric, sql, timingMs, tenant }) => {
      // custom telemetry
    },
  },
});
```

### 5.5 SQL Injection Prevention

- All filter values are parameterized (never interpolated into SQL strings)
- Field names in dimensions/filters are validated against the dataset's field definitions (whitelist)
- Formula helpers (`divide`, `subtract`, etc.) generate parameterized SQL — they do not concatenate
- The `sql` tagged template interpolates metric references symbolically, not as raw strings
- Custom `sql` expressions in field definitions are developer-authored (trusted code, not user input)

### 5.6 Query Complexity Limits

Datasets can declare limits to prevent expensive queries:

```ts
const Orders = dataset("orders", {
  // ...fields...
  limits: {
    maxDimensions: 5,
    maxFilters: 10,
    maxResultSize: 10_000,
  },
});
```

The executor validates these before generating SQL. Violations return a `400` with a clear error message.

### 5.7 Schema Compatibility

`@hypequery/schema` now provides a compatibility bridge for checking whether physical schema changes break semantic dataset definitions.

Standalone:

```ts
checkDatasetsAgainstSchema({
  snapshot,
  datasets: [Orders],
});
```

Migration planning:

```ts
createMigrationPlan(diffSnapshots(previousSnapshot, nextSnapshot), {
  semanticCompatibility: {
    datasets: [Orders],
  },
});
```

Current v1 checks include:

- missing dataset sources
- missing dimension columns
- missing measure fields
- missing `tenantKey`
- missing `timeKey`
- invalid filtered-measure fields
- `sum` / `avg` on non-numeric physical columns

---

## 6. Deliverables by PR

### PR 1: Dataset & Field Primitives

- `dataset()` function and return type
- `dimension.*()` helpers
- `belongsTo()`, `hasMany()`, `hasOne()` relationship helpers
- `DatasetRegistry` — runtime registry of defined datasets
- Type inference for dataset fields
- Tests: dataset definition, field typing, and relationship metadata

### PR 2: Base Metrics & Executor

- `Dataset.metric()` method
- Aggregation helpers: `sum`, `count`, `countDistinct`, `avg`, `min`, `max`
- `MetricExecutor` — SQL generation + execution for base metrics
- `MetricRef` type with `.contract()` method
- Tenant auto-injection in generated SQL
- Tests: SQL generation, parameterization, tenant injection, contract generation

### PR 3: Derived Metrics & Formula System

- Derived metric support in `Dataset.metric()` (the `uses` + `formula` pattern)
- Formula helpers: `divide`, `multiply`, `subtract`, `add`, `nullIfZero`, `coalesce`, `round`
- `sql` tagged template for escape-hatch formulas
- CTE-based SQL generation for derived metrics
- Tests: formula resolution, CTE generation, nested derivation

### PR 4: Serve Integration

- `metrics` key in `createAPI()` config
- Auto-generated `POST /api/metrics/:name` endpoints
- Request validation against metric contracts
- OpenAPI schema generation from contracts
- Per-metric auth and cache overrides
- Meta/envelope response modes
- Tests: endpoint generation, auth, caching, tenant isolation, OpenAPI output

### PR 5: Client Hooks (`useMetric`)

- `useMetric()` hook in `@hypequery/react`
- Type inference from API type → metric name → dimensions/filters/result
- TanStack Query integration (same patterns as existing `useQuery`)
- Tests: type inference, cache key generation, error handling

### PR 6: Time Graining (`.by()`)

- `.by(grain)` operator on `MetricRef`
- `GrainedMetric` type with `period` in result
- Dialect-aware date truncation in SQL generator (ClickHouse `toStartOf*`, Postgres `DATE_TRUNC`)
- Tests: grain SQL generation per dialect, type inference for grained results

### Future: Time Comparison & Rolling Windows

- `.rolling(window)` operator
- `.compare(previousPeriod)` operator with formula
- Window function / self-join SQL generation
- Dialect-specific window function syntax

### Future: Cross-Dataset Derived Metrics

- Standalone `metric()` function (not dataset-attached) with explicit `inputs` from multiple datasets
- `alignBy` for specifying join dimensions
- CTE-per-dataset + join SQL generation

---

## 7. Complete Example

```ts
// ── datasets/customers.ts ──
import { dataset, field } from '@hypequery/serve';

export const Customers = dataset("customers", {
  source: "customers",
  tenantKey: "tenant_id",

  fields: {
    id: field.string(),
    name: field.string({ label: "Customer Name" }),
    country: field.string({ label: "Country" }),
    createdAt: field.timestamp(),
  },
});

// ── datasets/orders.ts ──
import { dataset, field, belongsTo, sum, count, countDistinct } from '@hypequery/serve';
import { divide, nullIfZero } from '@hypequery/serve';
import { Customers } from './customers';

export const Orders = dataset("orders", {
  source: "orders",
  tenantKey: "tenant_id",
  timeKey: "created_at",

  fields: {
    id: field.string(),
    customerId: field.string(),
    country: field.string({ label: "Country" }),
    status: field.string({ label: "Order Status" }),
    amount: field.number({ label: "Amount" }),
    createdAt: field.timestamp({ label: "Created At" }),
  },

  relationships: {
    customer: belongsTo(() => Customers, {
      from: "customerId",
      to: "id",
    }),
  },
});

// ── metrics/orders.ts ──

export const totalRevenue = Orders.metric("totalRevenue", {
  value: sum("amount"),
  label: "Total Revenue",
});

export const orderCount = Orders.metric("orderCount", {
  value: count("id"),
  label: "Order Count",
});

export const uniqueCustomers = Orders.metric("uniqueCustomers", {
  value: countDistinct("customerId"),
  label: "Unique Customers",
});

export const avgOrderValue = Orders.metric("avgOrderValue", {
  uses: {
    revenue: totalRevenue,
    orders: orderCount,
  },
  formula: ({ revenue, orders }) =>
    divide(revenue, nullIfZero(orders)),
  label: "Average Order Value",
});

export const monthlyRevenue = totalRevenue.by("month");

// ── server.ts ──
import { createAPI, serve } from '@hypequery/serve';
import { bearerStrategy } from './auth';
import { totalRevenue, orderCount, avgOrderValue, monthlyRevenue } from './metrics/orders';

const api = createAPI({
  metrics: {
    totalRevenue,
    orderCount,
    avgOrderValue,
    monthlyRevenue,
  },

  queries: {
    // Existing hand-written queries — unchanged
    recentOrders: query
      .output(z.array(OrderSchema))
      .cache(60_000)
      .query(async ({ ctx }) => {
        return hypequery
          .table('orders')
          .select(['id', 'customerId', 'amount', 'createdAt'])
          .where('status', 'eq', 'completed')
          .orderBy('createdAt', 'desc')
          .limit(50)
          .execute();
      }),
  },

  auth: bearerStrategy,
  tenant: {
    extract: (auth) => auth.tenantId,
    required: true,
    mode: 'auto-inject',
  },
  caching: { defaultTtl: 30_000 },
  queryLogging: true,
});

serve(api, { port: 3000 });

// ── client.tsx ──
import { createHooks } from '@hypequery/react';
import type { api } from './server';

const { useMetric, useQuery } = createHooks<typeof api>({
  baseUrl: '/api',
});

function Dashboard() {
  const { data: revenue } = useMetric("totalRevenue", {
    dimensions: ["country"],
    filters: { status: "completed" },
    orderBy: [{ field: "totalRevenue", direction: "desc" }],
    limit: 10,
  });
  // revenue: Array<{ country: string, totalRevenue: number }>

  const { data: trend } = useMetric("monthlyRevenue", {
    filters: { country: "US" },
  });
  // trend: Array<{ period: string, totalRevenue: number }>

  const { data: orders } = useQuery("recentOrders");
  // orders: Array<{ id: string, customerId: string, ... }>
}
```

---

## 8. Scope Summary

| Feature | Status |
|---------|--------|
| Datasets with typed fields | **Ship now** |
| Dataset relationships (model metadata) | **Ship now** |
| Relationship-aware query execution | **Ship next** |
| Base metrics (sum, count, avg, min, max, countDistinct) | **Ship now** |
| Same-dataset derived metrics (formula) | **Ship now** |
| Metric contracts | **Ship now** |
| Serve integration (auto-generated endpoints) | **Ship now** |
| `useMetric` React hook | **Ship now** |
| Tenant auto-injection | **Ship now** |
| Auth per metric | **Ship now** |
| Caching | **Ship now** |
| Time graining (`.by()`) | **Ship now** |
| Rolling windows (`.rolling()`) | **Ship next** |
| Previous period comparison (`.compare()`) | **Ship next** |
| Explainability / SQL preview | **Ship next** |
| Cross-dataset derived metrics | **Delay** |
| Generic `extends` / inheritance | **Avoid** |
| Materialized views | **Avoid** |
| YAML model definitions | **Avoid** |

---

## 9. What This Is Not

- **Not a BI tool.** Hypequery does not render charts or build dashboards. It serves typed data that frontend tools consume.
- **Not Cube.** The API is a semantic layer in code, but it avoids external model DSLs, pre-aggregations, and REST/GraphQL API sprawl. Datasets and metrics stay TypeScript-native.
- **Not an ORM.** The existing query builder handles arbitrary reads. Datasets/metrics handle canonical analytics values. They coexist.
- **Not a materialization engine.** No DDL management, no refresh policies, no view lifecycle. Cache with TTLs. Materialize externally if needed.
