# Semantic Layer for Hypequery — Current State Analysis & Implementation Plan

## Current State Analysis

### What exists today

Hypequery is a **type-safe ClickHouse query builder** organized as a monorepo with four packages:

| Package | Purpose |
|---|---|
| `@hypequery/clickhouse` | Core query builder — SQL generation, filtering, joins, aggregations, caching |
| `@hypequery/serve` | HTTP server layer — exposes query builders as authenticated REST endpoints |
| `@hypequery/react` | React hooks — client-side data fetching via TanStack Query |
| `@hypequery/cli` | CLI tooling — schema introspection, TypeScript codegen, project scaffolding |

### Architecture summary

```
DatabaseSchema (TS type) → QueryBuilder<Schema, State> → SQL → ClickHouse → typed rows
```

- **Schema is purely a TypeScript type** — `Record<tableName, Record<columnName, ClickHouseType>>`. It has no runtime representation, no business semantics, and no abstraction beyond physical column types.
- **QueryBuilder** is a fluent, immutable builder that tracks state via generics (`BuilderState<Schema, VisibleTables, OutputRow, BaseTable, Aliases>`). Features are composed as classes: `AggregationFeature`, `FilteringFeature`, `JoinFeature`, `AnalyticsFeature`, `QueryModifiersFeature`, `CrossFilteringFeature`.
- **JoinRelationships** is the closest thing to a semantic concept — it lets users pre-define named join paths between tables. But it's imperative (`.define('name', path)`) and has no declarative schema.
- **Aggregations** are raw SQL (`SUM(col) AS alias`) — no concept of reusable measures.
- **Serve** wraps query builders into HTTP endpoints with Zod validation, auth, caching, and middleware — but each endpoint is hand-written; there's no way to auto-generate queries from a model definition.

### What's missing for a semantic layer

| Concern | Current State | Gap |
|---|---|---|
| **Dimensions** | Users manually `.select(['col'])` | No named, reusable dimension definitions with labels/descriptions |
| **Measures** | Users manually call `.sum('col', 'alias')` | No pre-defined, reusable measure definitions |
| **Relationships / Joins** | `JoinRelationships` exists but is imperative and disconnected from models | No declarative model-to-model relationship graph |
| **Model / Dataset abstraction** | None — users work directly with physical table names | No logical model layer that maps business concepts to physical tables |
| **Calculated fields** | Users use `raw()` / `rawAs()` | No declarative calculated column definitions |
| **Access control on fields** | Auth exists at endpoint level in `@hypequery/serve` | No field-level or model-level access control |
| **Auto-generated queries** | None | Can't ask "give me revenue by country" and have the system resolve joins, groupings, and aggregations |
| **YAML/JSON model files** | None | No declarative file format for defining models |

---

## Implementation Plan

### Phase 1: Core Semantic Model Types & Registry

Define the foundational types and a runtime registry for semantic models.

**New file: `packages/clickhouse/src/semantic/types.ts`**

```ts
interface DimensionDefinition {
  name: string;
  sql: string;              // e.g. "users.country" or SQL expression
  type: 'string' | 'number' | 'date' | 'boolean';
  label?: string;
  description?: string;
  primaryKey?: boolean;
}

interface MeasureDefinition {
  name: string;
  sql: string;              // e.g. "orders.amount"
  type: 'count' | 'sum' | 'avg' | 'min' | 'max' | 'countDistinct' | 'custom';
  label?: string;
  description?: string;
  format?: string;          // e.g. "currency", "percent"
  filters?: FilterDefinition[];  // measure-level default filters
}

interface RelationshipDefinition {
  model: string;            // target model name
  join: 'inner' | 'left' | 'right' | 'full';
  sql: string;              // e.g. "${orders}.user_id = ${users}.id"
}

interface ModelDefinition {
  name: string;
  table: string;            // physical table name
  label?: string;
  description?: string;
  dimensions: DimensionDefinition[];
  measures: MeasureDefinition[];
  relationships?: RelationshipDefinition[];
}
```

**New file: `packages/clickhouse/src/semantic/model-registry.ts`**

- A `ModelRegistry` class that stores model definitions
- Validates model definitions (no duplicate names, valid SQL references)
- Resolves relationship graphs between models
- Type-safe: generic over the `DatabaseSchema` to validate table/column references

**Changes:**
1. Create `packages/clickhouse/src/semantic/` directory
2. Create `types.ts` with all semantic type definitions
3. Create `model-registry.ts` with `ModelRegistry` class
4. Create `define-model.ts` — a `defineModel<Schema>()` helper for type-safe model creation
5. Export from `packages/clickhouse/src/index.ts`

---

### Phase 2: `defineDataset` API — Query Generation from Semantic Models

A `Dataset` is a query context built on top of one or more models. Users select dimensions and measures, and the system auto-generates the correct SQL with joins, GROUP BY, and aggregations.

**New file: `packages/clickhouse/src/semantic/dataset.ts`**

```ts
// User-facing API
const dataset = defineDataset(registry, {
  model: 'orders',
  dimensions: ['orders.country', 'users.name'],
  measures: ['orders.total_revenue', 'orders.order_count'],
  filters: [{ dimension: 'orders.status', operator: 'eq', value: 'completed' }],
  orderBy: [{ name: 'orders.total_revenue', direction: 'desc' }],
  limit: 100,
});

// dataset.toSQL()  → generates full SQL
// dataset.execute() → runs against ClickHouse, returns typed results
```

**Implementation details:**
- Resolves which models are needed based on selected dimensions/measures
- Automatically discovers join paths via the relationship graph in `ModelRegistry`
- Generates SELECT (dimensions + aggregated measures), FROM, JOIN, WHERE, GROUP BY, ORDER BY, LIMIT
- Internally delegates to the existing `QueryBuilder` for SQL generation and execution
- Returns type-safe results inferred from the selected dimensions and measures

**Changes:**
1. Create `packages/clickhouse/src/semantic/dataset.ts`
2. Create `packages/clickhouse/src/semantic/query-planner.ts` — resolves join paths and builds execution plan
3. Create `packages/clickhouse/src/semantic/sql-generator.ts` — converts a dataset definition into QueryBuilder calls
4. Add tests in `packages/clickhouse/src/semantic/__tests__/`

---

### Phase 3: YAML Model Definitions & CLI Integration

Allow models to be defined in YAML files (similar to dbt/Cube.js) and generate TypeScript from them.

**New file format: `models/*.yml`**

```yaml
name: orders
table: orders
label: Orders
description: All customer orders

dimensions:
  - name: id
    sql: "{TABLE}.id"
    type: number
    primaryKey: true
  - name: status
    sql: "{TABLE}.status"
    type: string
  - name: created_at
    sql: "{TABLE}.created_at"
    type: date

measures:
  - name: count
    type: count
  - name: total_revenue
    sql: "{TABLE}.amount"
    type: sum
    format: currency

relationships:
  - model: users
    join: left
    sql: "{orders}.user_id = {users}.id"
```

**CLI changes in `@hypequery/cli`:**
1. New `hypequery generate-models` command — reads YAML files, validates against DB schema, outputs TypeScript model definitions
2. Extend existing `hypequery generate` to optionally produce model stubs from introspected schema
3. YAML schema validation with clear error messages

---

### Phase 4: Serve Integration — Auto-Generated Endpoints

Expose datasets as REST endpoints automatically.

**New API in `@hypequery/serve`:**

```ts
const api = defineServe({
  context: createContext,
  queries: {
    // Existing manual approach still works
    manualQuery: query.query(async ({ ctx }) => { ... }),

    // NEW: auto-generated from dataset
    ...generateDatasetEndpoints(registry, {
      models: ['orders', 'users'],
      auth: bearerStrategy,
      // Auto-generates /query endpoint that accepts dimensions/measures/filters
    }),
  },
});
```

**Changes:**
1. Create `packages/serve/src/dataset-endpoints.ts` — generates serve endpoints from model registry
2. The generated endpoint accepts `{ dimensions, measures, filters, orderBy, limit }` as input
3. Validates requested dimensions/measures against the registry
4. Zod schemas auto-generated from model definitions
5. Field-level access control: models can declare which roles can access which dimensions/measures

---

### Phase 5: React Integration & Developer Experience

**Changes to `@hypequery/react`:**
1. Add `useDatasetQuery` hook that provides a builder-style API for selecting dimensions/measures
2. Auto-complete support via TypeScript inference from model definitions

**Developer experience:**
1. VS Code extension recommendations for YAML model editing
2. Documentation pages on the website

---

## Execution Order & Dependencies

```
Phase 1 (Core Types & Registry)
    ↓
Phase 2 (Dataset API & Query Generation)  ← This is the highest-value deliverable
    ↓
Phase 3 (YAML + CLI)  ←  Phase 4 (Serve Integration)
                              ↓
                       Phase 5 (React + DX)
```

**Phase 1 and 2 are the critical path.** They deliver the core semantic layer value: users define models once and query by business concepts instead of raw SQL. Phases 3-5 are additive improvements to DX and integration.

---

## Key Design Decisions to Make

1. **Should the Dataset API reuse QueryBuilder internally or generate SQL independently?**
   - Recommendation: **Reuse QueryBuilder** — it already handles SQL generation, parameterization, caching, and execution. The Dataset layer should be a higher-level orchestrator that calls into QueryBuilder.

2. **Should model definitions live in TypeScript or YAML?**
   - Recommendation: **TypeScript-first, YAML optional** — TypeScript definitions give full type safety and IDE support. YAML is added in Phase 3 as an alternative for teams that prefer declarative config files.

3. **How should join path resolution work when multiple paths exist between models?**
   - Recommendation: **Shortest path by default, explicit override via relationship names** — the query planner finds the shortest join path in the relationship graph, but users can specify preferred paths.

4. **Should measures support custom SQL expressions beyond the built-in aggregation types?**
   - Recommendation: **Yes** — support a `type: 'custom'` with arbitrary SQL, similar to how Cube.js handles this. This keeps the system extensible without bloating the core types.
