# @hypequery/datasets

Type-safe semantic analytics definitions for Hypequery.

Use this package to define datasets, dimensions, measures, metrics, derived metrics, and runtime validation rules in TypeScript. `@hypequery/datasets` owns semantic meaning and planning; `@hypequery/clickhouse` owns query construction and execution; `@hypequery/serve` owns HTTP/runtime delivery.

## Install

```bash
npm install @hypequery/datasets
# or
pnpm add @hypequery/datasets
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
}, {
  runtime: {
    tenant: 'tenant_123',
  },
});

const monthlySql = analytics.toSQL(revenue.by('month'), {
  dimensions: ['country'],
}, {
  runtime: {
    tenant: 'tenant_123',
  },
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

If `tenantKey` is set, queries against the dataset require runtime tenant context. This is fail-closed: Hypequery will reject metric and dataset queries that do not include a tenant runtime value or an explicitly enabled cross-tenant scope.

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

### Time Grains

Use `.by(grain)` on a metric when the dataset has a `timeKey`.

```ts
const monthlyRevenue = revenue.by('month');

await analytics.execute(monthlyRevenue, {
  dimensions: ['country'],
}, {
  runtime: {
    tenant: 'tenant_123',
  },
});
```

Supported grains are `day`, `week`, `month`, `quarter`, and `year`.

### Runtime Tenancy

Runtime tenancy uses the dataset `tenantKey` and a runtime tenant identity.

```ts
const Orders = dataset('orders', {
  source: 'orders',
  tenantKey: 'tenant_id',
  dimensions: {
    tenantId: dimension.string({ column: 'tenant_id' }),
    country: dimension.string(),
  },
  measures: {
    revenue: measure.sum('amount'),
  },
});

const revenue = Orders.metric('revenue', { measure: 'revenue' });

await analytics.execute(revenue, {}, {
  runtime: {
    tenant: 'tenant_123',
  },
});
```

Here `tenantKey` is the physical column and `runtime.tenant` is the trusted runtime value. Together they produce a tenant predicate equivalent to:

```sql
WHERE tenant_id = 'tenant_123'
```

If a dataset has `tenantKey`, runtime tenant context is required:

```ts
await analytics.execute(revenue);
// Error: Dataset "orders" requires runtime tenant scoping.
```

You can also provide a trusted set of tenants for admin dashboards that are scoped to multiple accounts:

```ts
await analytics.execute(revenue, {}, {
  runtime: {
    tenant: { in: ['tenant_123', 'tenant_456'] },
  },
});
```

This produces a tenant predicate equivalent to:

```sql
WHERE tenant_id IN ('tenant_123', 'tenant_456')
```

When runtime tenancy is active, explicit filters on the tenant field are rejected. This prevents duplicate or conflicting tenant predicates:

```ts
await analytics.execute(revenue, {
  filters: [eq('tenantId', 'tenant_123')],
}, {
  runtime: {
    tenant: 'tenant_123',
  },
});
// Error: Cannot filter on tenant field "tenantId" when runtime tenancy enforcement is active.
```

The runtime integration should provide tenant identity from trusted server/session state. Do not accept tenant ids from end-user query input. In `@hypequery/serve`, regular hand-written queries can use Serve tenant auto-injection, but semantic dataset and metric endpoints pass tenant identity to `@hypequery/datasets`, and datasets injects the filter from `tenantKey`.

For jobs, admin tools, or reporting surfaces that intentionally query across tenants, use `runtime.tenant: { scope: 'all' }`:

```ts
await analytics.execute(revenue, {}, {
  runtime: {
    tenant: { scope: 'all' },
  },
});
```

`scope: 'all'` omits the tenant predicate for every `tenantKey` dataset touched by the semantic query. Use this only in trusted contexts like background jobs or admin dashboards, not in request-facing clients or MCP servers.

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
}, {
  runtime: {
    tenant: 'tenant_123',
  },
});

const sql = analytics.toSQL(revenue, {
  dimensions: ['country'],
}, {
  runtime: {
    tenant: 'tenant_123',
  },
});

const result = await analytics.execute(revenue, {
  dimensions: ['country'],
}, {
  runtime: {
    tenant: 'tenant_123',
  },
});

const datasetResult = await analytics.execute(Orders, {
  dimensions: ['country'],
  measures: ['revenue'],
}, {
  runtime: {
    tenant: 'tenant_123',
  },
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

await analytics.execute(revenue, { dimensions: ['country'] }, {
  runtime: {
    tenant: 'tenant_123',
  },
});
```

### Other Backends

The `SemanticBackend` interface enables support for other databases. Future packages like `@hypequery/duckdb` or `@hypequery/postgres` would follow the same pattern.

## Serve Integration

`@hypequery/serve` can expose metric and dataset endpoints from dataset definitions. Dataset endpoint planning uses `@hypequery/datasets/internal` as a package-integration boundary.

Do not import `@hypequery/datasets/internal` in application code unless you are integrating Hypequery packages. It is intentionally not the public user-facing API.

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

## What Is Not Public API

- `dataset.query(...)`
- Root exports for dataset endpoint execution helpers
- Deep imports from package internals
- Automatic relationship JOIN execution
- Cross-dataset derived metrics

## License

Apache-2.0.
