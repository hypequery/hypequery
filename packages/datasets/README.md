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
  MetricExecutor,
  dataset,
  dimension,
  divide,
  eq,
  measure,
  nullIfZero,
} from '@hypequery/datasets';
import { createQueryBuilder } from '@hypequery/clickhouse';

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

const builderFactory = createQueryBuilder({
  host: process.env.CLICKHOUSE_HOST,
  username: process.env.CLICKHOUSE_USER,
  password: process.env.CLICKHOUSE_PASSWORD,
  database: process.env.CLICKHOUSE_DATABASE,
});

const executor = new MetricExecutor({ builderFactory });

const result = await executor.run(revenue, {
  dimensions: ['country'],
  filters: [eq('status', 'completed')],
  orderBy: [{ field: 'revenue', direction: 'desc' }],
  limit: 10,
});

const monthlySql = executor.toSQL(revenue.by('month'), {
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

### Time Grains

Use `.by(grain)` on a metric when the dataset has a `timeKey`.

```ts
const monthlyRevenue = revenue.by('month');

await executor.run(monthlyRevenue, {
  dimensions: ['country'],
});
```

Supported grains are `day`, `week`, `month`, `quarter`, and `year`.

### Runtime Tenancy

Runtime tenancy uses the dataset `tenantKey` and a runtime tenant identity.

```ts
await executor.run(revenue, {}, {
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

`MetricExecutor` accepts a query builder factory compatible with `@hypequery/clickhouse`.

```ts
const executor = new MetricExecutor({ builderFactory });

const validation = executor.validate(revenue, {
  dimensions: ['country'],
});

const sql = executor.toSQL(revenue, {
  dimensions: ['country'],
});

const result = await executor.run(revenue, {
  dimensions: ['country'],
});
```

The executor validates dimensions, filters, order fields, limits, time grain requirements, tenant filtering, and derived metric plans before execution.

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
