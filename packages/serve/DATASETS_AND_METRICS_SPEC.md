# Datasets & Metrics API — Implementation Spec v2

> **Status:** Draft v2 — complete rewrite reflecting the dataset-centric architecture.
> **Prerequisite:** The `createAPI()` / transport-separation PR.

---

## 1. Design Philosophy

Hypequery's analytics layer is built on four primitives:

| Layer | Purpose | Feel |
|-------|---------|------|
| **Dataset** | Typed data contract + analytics defaults | Like a Drizzle/Prisma schema, but for analytics |
| **Metric** | Canonical, reusable business values | Dataset-attached, composable |
| **Query** | Shaped reads (existing query builder) | Unchanged — `table().select().where().execute()` |
| **Serve** | Execution runtime | Auth, tenancy, caching, transport |

Key departures from the previous spec:
- **No `defineModel` / dimensions / measures vocabulary.** Datasets have fields and metrics. This avoids the Cube-like semantic model feel.
- **No `useDataset` hook.** The React client consumes metrics via `useMetric`, not arbitrary dataset queries.
- **No `defineDashboard`.** Dashboard composition is a UI concern, not a server primitive.
- **No materialization.** Out of scope — too much DDL lifecycle complexity.
- **Queries stay as-is.** The existing type-safe query builder (`table().select().where()`) and serve query endpoints are unchanged. No new query abstraction.

---

## 2. Architecture Overview

```
┌──────────────────────────────────────────────────────────────┐
│  serve({                                                      │
│    metrics: { totalRevenue, avgOrderValue, revenueGrowthMoM } │
│    queries: { recentOrders: query.query(async () => ...) }    │
│    auth, caching, tenant                                      │
│  })                                                           │
│                                                               │
│  ┌──────────────────────┐   ┌───────────────────────────┐    │
│  │  Queries (unchanged) │   │  Datasets + Metrics        │    │
│  │  query: fn()         │   │                            │    │
│  │  ↓                   │   │  Dataset ──→ Metric        │    │
│  │  QueryBuilder        │   │              ↓             │    │
│  │  ↓                   │   │         MetricExecutor     │    │ ← NEW
│  │  adapter.execute()   │   │              ↓             │    │
│  │                      │   │         adapter.execute()  │    │
│  └──────────────────────┘   └───────────────────────────┘    │
│                                                               │
│  ServeHandler ──→ transports (serve, node, fetch)             │
└──────────────────────────────────────────────────────────────┘
```

---

## 3. API Design

### 3.1 Dataset Definition

A dataset is a typed data contract over a physical table. Fields are inferred from the schema by default; explicit field config is for overrides only (labels, custom types, grain hints).

```ts
import { dataset, field, belongsTo } from '@hypequery/serve';

const Customers = dataset("customers", {
  source: "customers",
  tenantKey: "tenant_id",

  fields: {
    id: field.string(),
    country: field.string(),
    createdAt: field.timestamp(),
  },
});

const Orders = dataset("orders", {
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
```

**Design notes:**

- `source` is the physical table name. The dataset name (first arg) is the logical name.
- `tenantKey` declares which column holds the tenant ID. The runtime auto-injects `WHERE tenant_id = ?` based on the serve tenant config. Same `auto-inject` / `manual` modes as existing queries.
- `timeKey` declares the default time dimension for time-series operations (`.by()`, `.rolling()`, `.compare()`).
- `field.*()` functions are lightweight type markers. They don't create runtime overhead — they produce metadata used for contract generation, validation, and type inference.
- Relationships use lazy thunks (`() => Customers`) to avoid circular import issues.

**Field types:**

```ts
field.string(opts?)      // string dimension
field.number(opts?)      // numeric dimension/metric source
field.boolean(opts?)     // boolean dimension
field.timestamp(opts?)   // time dimension — supports graining

// Common options:
interface FieldOptions {
  label?: string;
  description?: string;
}
```

**Relationship types:**

```ts
belongsTo(() => Target, { from, to })  // many-to-one (FK on this table)
hasMany(() => Target, { from, to })    // one-to-many (FK on target table)
hasOne(() => Target, { from, to })     // one-to-one (FK on target table)
```

### 3.2 Base Metrics

Base metrics are dataset-attached aggregations. They are the canonical business values — named, documented, and reusable.

```ts
import { sum, count, countDistinct, avg, min, max } from '@hypequery/serve';

const totalRevenue = Orders.metric("totalRevenue", {
  value: sum("amount"),
  label: "Total Revenue",
  description: "Sum of all order amounts",
});

const orderCount = Orders.metric("orderCount", {
  value: count("id"),
});

const uniqueCustomers = Orders.metric("uniqueCustomers", {
  value: countDistinct("customerId"),
});

const avgAmount = Orders.metric("avgAmount", {
  value: avg("amount"),
});
```

**Aggregation helpers:**

Each helper takes a field name (type-checked against the dataset's fields) and returns an `AggregationSpec`:

```ts
sum(field: string): AggregationSpec
count(field: string): AggregationSpec
countDistinct(field: string): AggregationSpec
avg(field: string): AggregationSpec
min(field: string): AggregationSpec
max(field: string): AggregationSpec
```

**What `Orders.metric()` returns:**

A `MetricRef` — a lightweight, serializable handle that carries:
- The dataset it belongs to
- The metric name
- The aggregation spec
- The label/description metadata

```ts
interface MetricRef<
  TDataset extends string,
  TName extends string,
  TGrain extends string = never
> {
  readonly __type: 'metric_ref';
  readonly dataset: TDataset;
  readonly name: TName;
  readonly spec: AggregationSpec | DerivedMetricSpec;
  readonly label?: string;
  readonly description?: string;

  // Time operators (see §3.4)
  by(grain: TimeGrain): GrainedMetric<TDataset, TName, TimeGrain>;
  rolling(window: RollingWindow): GrainedMetric<TDataset, TName, string>;

  // Contract introspection (see §3.6)
  contract(): MetricContract;
}
```

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

The available dimensions and filters are constrained by the metric's dataset fields — both at the TypeScript level (autocomplete, compile errors) and at runtime (validation before SQL generation).

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
- Auto-injects tenant WHERE clause based on `tenant` config
- Inherits auth from global `auth` config
- Respects `caching` config (metric config is serializable → natural cache key)
- Returns `meta` only when explicitly opted in (via header or config)

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

### 4.1 MetricExecutor

The core runtime that resolves metrics to SQL and executes them.

```ts
class MetricExecutor {
  constructor(options: {
    adapter: DatabaseAdapter;
    datasets: DatasetRegistry;
  });

  /**
   * Execute a metric query. Resolves derived metrics,
   * generates SQL, applies tenant/filter context, executes.
   */
  run<T>(
    metric: MetricRef<any, any, any>,
    query: MetricQuery,
    context?: ExecutionContext,
  ): Promise<MetricResult<T>>;

  /**
   * Generate SQL without executing (debugging/logging).
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

### 4.2 SQL Generation Strategy

**Base metrics** — single SELECT with GROUP BY:

```sql
SELECT
  country,                        -- dimension
  SUM(amount) AS totalRevenue     -- metric aggregation
FROM orders
WHERE tenant_id = ?               -- auto-injected tenant
  AND status = ?                  -- user filter
GROUP BY country
ORDER BY totalRevenue DESC
LIMIT 100
```

**Derived metrics** — CTE wrapping base aggregations:

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

**Grained metrics** — time truncation in SELECT and GROUP BY:

```sql
SELECT
  toStartOfMonth(created_at) AS period,  -- ClickHouse
  -- DATE_TRUNC('month', created_at) AS period  -- Postgres
  SUM(amount) AS totalRevenue
FROM orders
WHERE tenant_id = ?
GROUP BY period
ORDER BY period
```

**Cross-relationship metrics** — JOIN via relationship definitions:

```sql
SELECT
  c.country,
  SUM(o.amount) AS totalRevenue
FROM orders o
LEFT JOIN customers c ON o.customer_id = c.id
WHERE o.tenant_id = ?
GROUP BY c.country
```

### 4.3 DatabaseAdapter Interface

```ts
interface DatabaseAdapter {
  execute<T = Record<string, unknown>>(
    sql: string,
    params?: unknown[],
  ): Promise<T[]>;

  /** Adapter dialect — drives date truncation, window functions, etc. */
  readonly dialect: 'clickhouse' | 'postgres';
}
```

The existing `@hypequery/clickhouse` adapter satisfies this interface. Additional adapters can be added for Postgres or testing.

---

## 5. Infrastructure Concerns

These are not afterthoughts — they are core to the runtime.

### 5.1 Tenant Isolation

Tenant isolation for metrics works identically to existing query tenancy:

- Datasets declare `tenantKey` (the column holding tenant ID)
- Serve config declares `tenant.extract` (how to get tenant ID from auth)
- `MetricExecutor` auto-injects `WHERE {tenantKey} = ?` for every metric query
- `mode: 'auto-inject'` (default) vs `mode: 'manual'` controls behavior
- **Tenant context is never optional in production** — a missing tenant ID rejects the request

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

---

## 6. Deliverables by PR

### PR 1: Dataset & Field Primitives

- `dataset()` function and return type
- `field.*()` helpers
- `belongsTo()`, `hasMany()`, `hasOne()` relationship helpers
- `DatasetRegistry` — runtime registry of defined datasets
- Type inference for dataset fields
- Tests: dataset definition, field typing, relationship resolution

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
| Dataset relationships | **Ship now** |
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
- **Not Cube.** No "semantic model" vocabulary, no pre-aggregations, no REST/GraphQL API soup. Datasets and metrics feel like TypeScript-native data contracts.
- **Not an ORM.** The existing query builder handles arbitrary reads. Datasets/metrics handle canonical analytics values. They coexist.
- **Not a materialization engine.** No DDL management, no refresh policies, no view lifecycle. Cache with TTLs. Materialize externally if needed.
