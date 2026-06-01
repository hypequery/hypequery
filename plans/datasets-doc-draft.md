# Datasets

## Status

Draft implementation notes that will later become product docs.

This document captures the current `@hypequery/datasets` direction after the semantic-layer stabilization work.

## What Datasets Is For

`@hypequery/datasets` is the semantic analytics layer.

It lets users define:

- dimensions
- measures
- filtered measures
- metrics
- derived metrics
- time-aware metric queries
- semantic validation rules

The package is not responsible for physical warehouse migrations.

That separation matters:

- `@hypequery/schema` owns physical schema truth
- `@hypequery/datasets` owns semantic meaning

## Core Model

Users define a dataset over a source table or view:

```ts
import { dataset, dimension, measure } from '@hypequery/datasets';

const Orders = dataset('orders', {
  source: 'orders',
  tenantKey: 'tenant_id',
  timeKey: 'created_at',
  dimensions: {
    id: dimension.number(),
    status: dimension.string(),
    createdAt: dimension.timestamp({ column: 'created_at' }),
  },
  measures: {
    revenue: measure.sum('amount'),
    orderCount: measure.count('id'),
  },
});
```

From that dataset, users define metrics:

```ts
const revenueMetric = Orders.metric('revenue', { measure: 'revenue' });
const orderCountMetric = Orders.metric('orderCount', { measure: 'orderCount' });
```

And derived metrics:

```ts
const avgOrderValueMetric = Orders.metric('avgOrderValue', {
  uses: {
    revenue: revenueMetric,
    orderCount: orderCountMetric,
  },
  formula: ({ revenue, orderCount }) => divide(revenue, nullIfZero(orderCount)),
});
```

## Filtered Measures

Filtered measures are supported.

```ts
const Orders = dataset('orders', {
  source: 'orders',
  dimensions: {
    id: dimension.number(),
    status: dimension.string(),
  },
  measures: {
    completedRevenue: measure.sum('amount', {
      filters: [eq('status', 'completed')],
    }),
  },
});
```

This is important because it closes a gap between the intended guide API and the implemented package surface.

## Runtime Tenancy

The semantic runtime contract is intentionally narrow:

```ts
runtime: {
  tenant: {
    id: 'acme',
  },
}
```

Public runtime tenancy does not expose:

- `column`
- `handledByBuilder`

Those are internal concerns and should not leak into the semantic-layer API.

The intended ownership boundary is:

- serve/runtime owns tenant identity
- dataset config owns `tenantKey`
- the datasets executor applies semantic tenant behavior consistently

## Derived Metrics

Derived metrics were a major stabilization area.

The important behavior now is:

- ungrouped derived metrics do not emit invalid `GROUP BY`
- grouped derived metrics only group by real dimensions and time grain output
- aggregate aliases are not treated as grouping dimensions
- invalid derived query plans are validated before execution

This fixes broken SQL shapes like:

```sql
WITH base AS (
  SELECT SUM(amount) AS revenue, COUNT(id) AS orderCount
  FROM test_orders
  GROUP BY revenue
)
SELECT (revenue) / (NULLIF(orderCount, 0)) AS avgOrderValue
FROM base
```

## Public API Direction

The current public API intentionally removed incomplete surface area.

Removed from the public API:

- `dataset.query(...)`

Reason:

- it exposed a public object with no complete public execution story

The pre-release direction is:

- prefer breaking changes that make the API clearer
- remove half-supported surface area instead of documenting around it

## Type Safety Direction

Current type-safety goals:

- preserve dataset name literals through `dataset()` and `metric()`
- distinguish base metrics from derived metrics
- require derived metrics to use base metrics from the same dataset
- preserve field literals through generic helpers like `eq()` and `desc()`

This keeps the package ergonomic without adding a second helper API surface.

## Relationship To Other Packages

`@hypequery/datasets` should work with:

- `@hypequery/clickhouse`
  - query building and execution backend
- `@hypequery/schema`
  - physical schema compatibility checks
- `@hypequery/serve`
  - runtime delivery, auth, tenancy, transport

It should not become a second schema/migrations package.

## Example Execution Flow

Standalone execution:

```ts
const executor = new MetricExecutor({ builderFactory });

const result = await executor.run(avgOrderValueMetric, {
  dimensions: ['status'],
});
```

SQL inspection:

```ts
const sql = executor.toSQL(avgOrderValueMetric, {
  dimensions: ['status'],
});
```

Validation:

```ts
const validation = executor.validate(avgOrderValueMetric, {
  dimensions: ['status'],
});
```

## Current Gaps

Still worth improving later:

- broader real ClickHouse integration coverage
- deeper docs and guide examples
- planner de-duplication between datasets and serve
- stronger compatibility checks against schema for SQL-heavy definitions

## Working Product Story

The current technical story is:

- define semantic analytics concepts in `@hypequery/datasets`
- verify they still match physical schema with `@hypequery/schema`
- expose them safely at runtime with `@hypequery/serve`

That is the intended layering, even before the final docs and positioning are polished.
