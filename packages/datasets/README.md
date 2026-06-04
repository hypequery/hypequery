# @hypequery/datasets

Type-safe semantic analytics definitions for Hypequery.

Use this package to define datasets, dimensions, measures, metrics, derived metrics, and runtime validation rules in TypeScript. `@hypequery/datasets` owns semantic meaning and planning; `@hypequery/clickhouse` owns query construction and execution; `@hypequery/serve` owns HTTP/runtime delivery.

`@hypequery/datasets` is the semantic layer. It is useful when you want analytics concepts in TypeScript rather than in YAML, raw SQL strings, or a separate BI server:

- datasets map physical tables or views to typed business fields
- dimensions and measures define the allowed query surface
- metrics name reusable business calculations
- derived metrics compose same-dataset metrics with symbolic formula helpers
- runtime validation rejects invalid dimensions, filters, ordering, limits, tenant filters, and derived metric plans before SQL is executed

## Install

```bash
npm install @hypequery/datasets
# or
pnpm add @hypequery/datasets
```

For ClickHouse execution, also install the ClickHouse backend package:

```bash
npm install @hypequery/clickhouse
```

## Quick Start

```ts
import {
  dataset,
  dimension,
  divide,
  eq,
  measure,
  nullIfZero,
  createDatasetClient,
} from '@hypequery/datasets';
import { createBackend } from '@hypequery/clickhouse';

const Orders = dataset('orders', {
  source: 'orders',
  tenantKey: 'tenant_id',
  timeKey: 'created_at',
  dimensions: {
    id: dimension.number(),
    tenantId: dimension.string({ column: 'tenant_id' }),
    status: dimension.string(),
    country: dimension.string(),
    createdAt: dimension.timestamp({ column: 'created_at' }),
  },
  measures: {
    revenue: measure.sum('amount'),
    orderCount: measure.count('id'),
    completedRevenue: measure.sum('amount', {
      filters: [eq('status', 'completed')],
    }),
  },
  filters: {
    status: {
      __type: 'filter_definition',
      field: 'status',
      operators: ['eq', 'neq', 'in', 'notIn'],
    },
  },
});

const revenue = Orders.metric('revenue', { measure: 'revenue' });
const orderCount = Orders.metric('orderCount', { measure: 'orderCount' });

const averageOrderValue = Orders.metric('averageOrderValue', {
  uses: { revenue, orderCount },
  formula: ({ revenue, orderCount }) =>
    divide(revenue, nullIfZero(orderCount)),
});

const analytics = createDatasetClient({
  backend: createBackend({
    url: process.env.CLICKHOUSE_URL,
    username: process.env.CLICKHOUSE_USER,
    password: process.env.CLICKHOUSE_PASSWORD,
    database: process.env.CLICKHOUSE_DATABASE,
  }),
});

const result = await analytics.execute(revenue, {
  dimensions: ['country'],
  filters: [eq('status', 'completed')],
  orderBy: [{ field: 'revenue', direction: 'desc' }],
  limit: 10,
});

const datasetResult = await analytics.execute(Orders, {
  dimensions: ['country', 'status'],
  measures: ['revenue', 'orderCount'],
  filters: [eq('status', 'completed')],
});

const monthlySql = analytics.toSQL(revenue.by('month'), {
  dimensions: ['country'],
});
```

## Public API

### `dataset(name, config)`

Creates a typed semantic model over a source table or view.

```ts
const Orders = dataset('orders', {
  source: 'orders',
  tenantKey: 'tenant_id',
  timeKey: 'created_at',
  dimensions: {
    id: dimension.number(),
    createdAt: dimension.timestamp({ column: 'created_at' }),
  },
  measures: {
    revenue: measure.sum('amount'),
  },
});
```

`source` is the physical table or view name. The first `dataset()` argument is the logical dataset name. `tenantKey` and `timeKey` are physical column names used for runtime tenant isolation and time graining.

### Dimensions

```ts
dimensions: {
  id: dimension.number(),
  status: dimension.string({ label: 'Status' }),
  isTrial: dimension.boolean({ column: 'is_trial' }),
  createdAt: dimension.timestamp({ column: 'created_at' }),
}
```

Dimension helpers are:

- `dimension.string(opts?)`
- `dimension.number(opts?)`
- `dimension.boolean(opts?)`
- `dimension.timestamp(opts?)`

Use `opts.column` when the semantic field name differs from the physical column. `opts.sql` exists for SQL-backed dimensions, but schema compatibility can only inspect simple column references and reports a warning for complex SQL expressions.

### Measures

```ts
measures: {
  revenue: measure.sum('amount'),
  orderCount: measure.count('id'),
  uniqueCustomers: measure.countDistinct('customerId'),
  averageAmount: measure.avg('amount'),
  minAmount: measure.min('amount'),
  maxAmount: measure.max('amount'),
}
```

Filtered measures use semantic filter helpers:

```ts
import { eq, measure } from '@hypequery/datasets';

const Orders = dataset('orders', {
  source: 'orders',
  dimensions: {
    status: dimension.string(),
  },
  measures: {
    completedRevenue: measure.sum('amount', {
      filters: [eq('status', 'completed')],
    }),
  },
});
```

### Metrics

Metrics are attached to a dataset and are defined from measures.

```ts
const revenue = Orders.metric('revenue', {
  measure: 'revenue',
  label: 'Revenue',
});
```

Derived metrics compose base metrics from the same dataset.

```ts
const averageOrderValue = Orders.metric('averageOrderValue', {
  uses: { revenue, orderCount },
  formula: ({ revenue, orderCount }) =>
    divide(revenue, nullIfZero(orderCount)),
});
```

Cross-dataset derived metrics and derived-from-derived metrics are intentionally rejected in the current public surface.

### Metric Queries vs Dataset Queries

Metrics and datasets support two related access patterns:

- Metric queries execute one named metric at a time. They are best for reusable product metrics such as `revenue`, `averageOrderValue`, or `monthlyRevenue`, while still allowing valid dimensions, filters, order fields, limits, and time grains.
- Dataset queries execute an ad-hoc selection of dimensions and measures from one dataset. They are best when callers need Cube-style flexibility within the same dataset, such as grouping by `country` and `status` while selecting both `revenue` and `orderCount`.

```ts
await analytics.execute(revenue, {
  dimensions: ['country'],
  filters: [eq('status', 'completed')],
});

await analytics.execute(Orders, {
  dimensions: ['country', 'status'],
  measures: ['revenue', 'orderCount'],
});
```

Both paths use the same dataset definition and validation rules. Metric queries provide named, reusable business contracts; dataset queries provide same-dataset exploration.

### Time Grains

Use `.by(grain)` on a metric when the dataset has a `timeKey`.

```ts
const monthlyRevenue = revenue.by('month');

await analytics.execute(monthlyRevenue, {
  dimensions: ['country'],
});
```

Supported grains are `day`, `week`, `month`, `quarter`, and `year`.

### Runtime Tenancy

Runtime tenancy uses the dataset `tenantKey` and a runtime tenant identity.

```ts
await analytics.execute(revenue, {}, {
  runtime: {
    tenant: { id: 'tenant_123' },
  },
});
```

When runtime tenancy is active, explicit filters on the tenant field are rejected. This prevents duplicate or conflicting tenant predicates.

### Relationships

Relationships can be stored as semantic metadata and exposed through introspection.

```ts
import { belongsTo } from '@hypequery/datasets';

const Orders = dataset('orders', {
  source: 'orders',
  dimensions: {
    customerId: dimension.string({ column: 'customer_id' }),
  },
  relationships: {
    customer: belongsTo(() => Customers, { from: 'customerId', to: 'id' }),
  },
});
```

For this release, relationship-aware query execution is not shipped. Query execution is same-dataset only. Relationship metadata is useful for documentation, agents, and schema compatibility checks.

## Execution

Use `createDatasetClient` from `@hypequery/datasets` with a backend implementation to execute semantic targets.

```ts
const validation = analytics.validate(revenue, {
  dimensions: ['country'],
});

const sql = analytics.toSQL(revenue, {
  dimensions: ['country'],
});

const result = await analytics.execute(revenue, {
  dimensions: ['country'],
});

const datasetResult = await analytics.execute(Orders, {
  dimensions: ['country'],
  measures: ['revenue'],
});
```

The semantic client validates dimensions, filters, order fields, limits, time grain requirements, tenant filtering, and derived metric plans before execution.

### ClickHouse Backend

For ClickHouse databases, use `createBackend` from `@hypequery/clickhouse`:

```ts
import { createDatasetClient } from '@hypequery/datasets';
import { createBackend } from '@hypequery/clickhouse';

const analytics = createDatasetClient({
  backend: createBackend({
    url: process.env.CLICKHOUSE_URL,
    username: process.env.CLICKHOUSE_USER,
    password: process.env.CLICKHOUSE_PASSWORD,
    database: process.env.CLICKHOUSE_DATABASE,
  }),
});

await analytics.execute(revenue, { dimensions: ['country'] });
```

### Other Backends

The `SemanticBackend` interface enables support for other databases. Future packages like `@hypequery/duckdb` or `@hypequery/postgres` would follow the same pattern.

## Integration Surfaces

Dataset definitions can be reused in several places:

- direct execution with `createDatasetClient(...)`
- SQL inspection with `analytics.toSQL(...)`
- runtime validation with `analytics.validate(...)`
- HTTP metric and dataset endpoints through `@hypequery/serve`
- agent-facing tools through `@hypequery/mcp`
- schema compatibility checks through `@hypequery/schema`

## Serve Integration

`@hypequery/serve` can expose metric and dataset endpoints from dataset definitions. Dataset endpoint planning uses `@hypequery/datasets/internal` as a package-integration boundary.

Do not import `@hypequery/datasets/internal` in application code unless you are integrating Hypequery packages. It is intentionally not the public user-facing API.

Metric endpoints expose named metrics. Dataset endpoints expose same-dataset ad-hoc dimensions and measures. Both surfaces are generated from dataset contracts, so invalid fields are rejected before execution.

## Agent Integration

`@hypequery/mcp` exposes dataset contracts, metric queries, and dataset queries over Model Context Protocol. This package does not run an MCP server directly; it provides the semantic definitions and execution client that the MCP package consumes.

## Schema Compatibility

Use `@hypequery/schema` to check whether physical schema changes break dataset definitions.

```ts
import { checkDatasetsAgainstSchema } from '@hypequery/schema';

const report = checkDatasetsAgainstSchema({
  snapshot,
  datasets: [Orders],
});

if (!report.valid) {
  console.error(report.diagnostics);
}
```

The checker validates source tables/views, dimension columns, measure fields, tenant/time keys, filtered measure fields, numeric measure types, and relationship join columns. Complex SQL expressions are reported with explicit limitation warnings.

## Current Scope And Limits

The current semantic execution surface is intentionally scoped:

- `dataset.query(...)` is not public API
- Root exports for dataset endpoint execution helpers are not public API
- Deep imports from package internals are not application API
- Automatic relationship JOIN execution is not shipped
- Cross-dataset derived metrics are rejected
- Derived-from-derived metrics are rejected
- Pre-aggregations or materialized rollups are not implemented
- BI tool protocol compatibility is not implemented

Relationship metadata is available for documentation, agents, and compatibility checks, but query execution is same-dataset only.

## License

Apache-2.0.
