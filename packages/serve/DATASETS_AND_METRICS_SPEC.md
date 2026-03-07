# Datasets & Metrics API — Implementation Spec

> **Status:** Draft — covers work planned for future PRs.
> **Prerequisite:** The `createAPI()` / transport-separation PR (this PR).

---

## 1. Context

This PR introduced `createAPI()` as a transport-agnostic entry point, with
standalone transport functions (`serve()`, `toNodeHandler()`, `toFetchHandler()`).
The semantic layer type system (`defineModel`, `dataset()` builder,
`DatasetConfig`, etc.) already exists in `packages/serve/src/semantic/`.

What's **missing** is the runtime bridge: taking a `DatasetConfig` and executing
it against a real database via the `DatabaseAdapter` interface. This spec
describes the remaining work to make the semantic layer fully operational.

---

## 2. Architecture Overview

```
┌─────────────────────────────────────────────────────────┐
│  createAPI({ models, queries })                         │
│                                                         │
│  ┌──────────────┐   ┌──────────────────────────────┐   │
│  │  Queries      │   │  Semantic Layer               │   │
│  │  (manual)     │   │                               │   │
│  │  query: fn()  │   │  ModelRegistry                │   │
│  │               │   │    ↓                          │   │
│  │               │   │  DatasetConfig (serializable) │   │
│  │               │   │    ↓                          │   │
│  │               │   │  DatasetExecutor              │   │  ← NEW
│  │               │   │    ↓                          │   │
│  │               │   │  DatabaseAdapter.execute()    │   │  ← NEW
│  └──────────────┘   └──────────────────────────────┘   │
│                                                         │
│  ServeHandler ──→ transports (serve, node, fetch)       │
└─────────────────────────────────────────────────────────┘
```

---

## 3. Deliverables by PR

### PR 2: Dataset Executor & SQL Generation

**Goal:** Given a `DatasetConfig` + `ModelRegistry`, generate SQL and execute it
via `DatabaseAdapter`.

#### 3.1 `DatasetExecutor`

```ts
// packages/serve/src/semantic/executor.ts

interface DatasetExecutorOptions<TSchema extends SemanticSchema> {
  models: ModelRegistry<TSchema>;
  adapter: DatabaseAdapter;
}

class DatasetExecutor<TSchema extends SemanticSchema> {
  constructor(options: DatasetExecutorOptions<TSchema>);

  /**
   * Execute a dataset query and return typed rows.
   * Validates dimensions/measures exist on the referenced model.
   */
  execute<TResult = Record<string, unknown>>(
    config: DatasetConfig,
  ): Promise<TResult[]>;

  /**
   * Generate SQL without executing (for debugging/logging).
   */
  toSQL(config: DatasetConfig): string;

  /**
   * Validate a DatasetConfig against the model registry.
   * Returns errors if dimensions/measures don't exist.
   */
  validate(config: DatasetConfig): ValidationResult;
}
```

#### 3.2 SQL Generation

The SQL generator translates `DatasetConfig` into a `SELECT` statement:

```sql
-- DatasetConfig:
--   model: 'orders'
--   dimensions: ['country', 'status']
--   measures: ['totalRevenue', 'orderCount']
--   filters: [{ dimension: 'status', operator: 'eq', value: 'completed' }]
--   orderBy: [{ field: 'totalRevenue', direction: 'desc' }]
--   limit: 100

SELECT
  country,
  status,
  SUM(amount) AS totalRevenue,
  COUNT(*) AS orderCount
FROM orders
WHERE status = 'completed'
GROUP BY country, status
ORDER BY totalRevenue DESC
LIMIT 100
```

Key behaviors:
- Dimensions go in SELECT + GROUP BY
- Measures go in SELECT with aggregation functions
- Filters on dimensions go in WHERE; filters on measures go in HAVING
- Custom `sql` expressions on dimensions/measures override the default column reference
- `include` (cross-model) generates JOINs based on relationship definitions

#### 3.3 `DatabaseAdapter` Interface

Already defined in `packages/serve/src/semantic/types.ts` (or a separate file).
The adapter receives generated SQL and parameters:

```ts
interface DatabaseAdapter {
  execute<T = Record<string, unknown>>(
    sql: string,
    params?: unknown[],
  ): Promise<T[]>;
}
```

Implementations to provide:
- `ClickHouseAdapter` (in `@hypequery/clickhouse`)
- Generic adapter for testing / other databases

#### 3.4 Tests

- SQL generation for all dimension/measure/filter/orderBy/limit combinations
- Cross-model JOINs via `include`
- Custom `sql` expressions
- Validation of invalid configs (unknown dimensions, unknown models)
- Execution via mock adapter

---

### PR 3: Auto-Generated Dataset Endpoints

**Goal:** Automatically expose models as query-able endpoints — no manual
`query:` functions needed for standard dataset queries.

#### 3.5 `createDatasetEndpoints()`

```ts
// Automatically registers /datasets/:model endpoints
const api = createAPI({
  models: { orders: OrderModel, customers: CustomerModel },
  adapter: clickhouseAdapter,
  queries: {
    // Manual queries still work alongside auto-generated ones
    customReport: { query: async () => { ... } },
  },
});

// Auto-generated endpoints:
// POST /api/analytics/datasets/orders   → accepts DatasetConfig body
// POST /api/analytics/datasets/customers → accepts DatasetConfig body
```

Each auto-generated endpoint:
- Accepts a `DatasetConfig` body (validated with Zod)
- Validates requested dimensions/measures exist on the model
- Generates SQL via `DatasetExecutor`
- Executes via `DatabaseAdapter`
- Returns typed results

#### 3.6 Auto-Generated OpenAPI Schemas

Each model endpoint should produce rich OpenAPI:
- Input schema derived from model's dimensions/measures (enum constraints)
- Output schema derived from selected fields
- Tags from model labels/descriptions

---

### PR 4: Client-Side Dataset Hooks

**Goal:** Type-safe React hooks for querying datasets.

#### 3.7 `useDataset()` Hook

```ts
// @hypequery/react
import { useDataset } from '@hypequery/react';
import type { InferDatasetResult } from '@hypequery/serve';

const { data, isLoading, error } = useDataset({
  model: 'orders',
  dimensions: ['country', 'status'],
  measures: ['totalRevenue'],
  filters: [{ dimension: 'status', operator: 'eq', value: 'completed' }],
});
// data is typed as Array<{ country: string; status: string; totalRevenue: number }>
```

#### 3.8 Type-Safe Inference

The dataset builder's phantom `_outputType` property enables end-to-end type
inference from model definition → dataset config → query result → React hook.

---

### PR 5: Metric Definitions & Pre-Computed Views

**Goal:** Named, reusable metric definitions that compose dataset queries.

#### 3.9 `defineMetric()`

```ts
const revenueByCountry = defineMetric({
  model: 'orders',
  dimensions: ['country'],
  measures: ['totalRevenue'],
  filters: [{ dimension: 'status', operator: 'eq', value: 'completed' }],
  // Optional: materialize as a ClickHouse materialized view
  materialize: {
    refreshInterval: '5m',
  },
});
```

Metrics can be:
- Exposed as named endpoints (`api.metric('revenueByCountry')`)
- Composed into dashboards
- Optionally materialized for performance

#### 3.10 Metric Composition

```ts
const dashboard = defineDashboard({
  metrics: {
    revenue: revenueByCountry,
    growth: revenueGrowthMoM,
    topProducts: topProductsByRevenue,
  },
  // Single endpoint returns all metrics in one request
});
```

---

## 4. Design Decisions & Constraints

### 4.1 SQL Injection Prevention
- All filter values MUST be parameterized (never interpolated into SQL)
- Dimension/measure names are validated against model definitions (whitelist)
- Custom `sql` expressions are developer-authored (trusted)

### 4.2 Tenant Isolation
- Dataset queries respect the existing tenant config
- `DatasetExecutor` receives tenant context and auto-injects WHERE clauses
- Same `auto-inject` / `manual` modes as regular queries

### 4.3 Auth & Authorization
- Auto-generated dataset endpoints inherit global auth strategies
- Per-model auth can be configured:
  ```ts
  defineModel<Schema, 'orders'>()({
    auth: { requireRole: 'analyst' },
    ...
  })
  ```

### 4.4 Caching
- DatasetConfig is serializable → natural cache key
- Cache headers flow through the existing `cacheTtlMs` system
- Materialized views (PR 5) provide server-side caching

### 4.5 Performance
- Generated SQL uses GROUP BY (not application-level grouping)
- Pagination via LIMIT/OFFSET (cursor-based pagination in future)
- Query complexity limits (max dimensions, max measures) configurable

---

## 5. Migration Path

Users on `defineServe()` can migrate incrementally:

```ts
// Step 1: Switch to createAPI (this PR)
const api = createAPI({ queries: existingQueries });
serve(api, { port: 3000 });

// Step 2: Add models (PR 2-3)
const api = createAPI({
  models: { orders: OrderModel },
  adapter: clickhouseAdapter,
  queries: existingQueries,
});

// Step 3: Add dataset hooks (PR 4)
// React client uses useDataset() alongside existing useQuery()

// Step 4: Define metrics (PR 5)
// Named metrics compose dataset queries
```

No breaking changes at any step. `defineServe()` remains supported (deprecated).

---

## 6. Open Questions

1. **Should `DatasetConfig` be a query param (GET) or body (POST)?**
   Leaning POST since configs can be complex, but GET is more cache-friendly.
   Decision: POST by default, with optional GET support for simple queries.

2. **How to handle cross-model JOINs in ClickHouse?**
   ClickHouse JOINs have different semantics than PostgreSQL. The adapter
   layer should handle dialect-specific join syntax.

3. **Should materialized views be managed by hypequery or external tooling?**
   Leaning toward hypequery generating the DDL but requiring explicit migration
   steps (not auto-applying).

4. **Rate limiting per model?**
   Dataset queries can be expensive. Consider per-model rate limits or
   query complexity scoring in the executor.
