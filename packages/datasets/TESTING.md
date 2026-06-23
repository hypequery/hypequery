# Testing @hypequery/datasets

Complete user-facing guide to testing datasets, metrics, and semantic queries.

## Table of Contents

1. [Quick Start](#quick-start)
2. [Pattern A: Using queryBuilder (Recommended)](#pattern-a-using-querybuilder-recommended)
3. [Pattern B: Using createBackend](#pattern-b-using-createbackend)
4. [Testing Datasets](#testing-datasets)
5. [Testing Metrics](#testing-metrics)
6. [Testing Derived Metrics](#testing-derived-metrics)
7. [Testing with Filters](#testing-with-filters)
8. [Testing Time Graining](#testing-time-graining)
9. [Testing Tenant Isolation](#testing-tenant-isolation)
10. [Troubleshooting](#troubleshooting)

---

## Quick Start

```bash
# Install dependencies
npm install @hypequery/datasets @hypequery/clickhouse

# For ClickHouse backend
npm install @clickhouse/client
```

---

## Pattern A: Using queryBuilder (Recommended)

This is the **recommended pattern** for most use cases. The dataset client reuses the same query builder you use for hand-written queries, sharing one connection.

### Setup

```typescript
import { createDatasetClient } from '@hypequery/datasets';
import { createQueryBuilder } from '@hypequery/clickhouse';

const queryBuilder = createQueryBuilder({
  url: 'http://localhost:8123',
  username: 'default',
  password: '',
  database: 'analytics',
});

const analytics = createDatasetClient({ queryBuilder });
```

### Test 1: Execute a Simple Dataset Query

```typescript
import { dataset, dimension, measure } from '@hypequery/datasets';

const Orders = dataset('orders', {
  source: 'orders',
  dimensions: {
    country: dimension.string(),
    status: dimension.string(),
  },
  measures: {
    revenue: measure.sum('amount'),
    count: measure.count('id'),
  },
});

// Execute dataset query
const result = await analytics.execute(Orders, {
  dimensions: ['country'],
  measures: ['revenue', 'count'],
});

console.log('Dataset query result:', result);
// Expected output:
// {
//   data: [
//     { country: 'US', revenue: 50000, count: 120 },
//     { country: 'UK', revenue: 30000, count: 85 }
//   ]
// }
```

### Test 2: Execute a Simple Metric

```typescript
const totalRevenue = Orders.metric('totalRevenue', {
  measure: 'revenue',
  label: 'Total Revenue',
});

const result = await analytics.execute(totalRevenue, {
  dimensions: ['country'],
});

console.log('Metric result:', result);
// Expected output:
// {
//   data: [
//     { country: 'US', totalRevenue: 50000 },
//     { country: 'UK', totalRevenue: 30000 }
//   ]
// }
```

---

## Pattern B: Using createBackend

This pattern uses the database-agnostic `SemanticBackend` protocol directly, building a standalone backend from connection config instead of sharing a query builder. Reach for it when you don't already have a query builder to pass.

### Setup

```typescript
import { createDatasetClient } from '@hypequery/datasets';
import { createBackend } from '@hypequery/clickhouse/datasets';

const analytics = createDatasetClient({
  backend: createBackend({
    url: 'http://localhost:8123',
    username: 'default',
    password: '',
    database: 'analytics',
  }),
});
```

The rest of the tests are the same as Pattern A!

---

## Testing Datasets

### Test: Query with Multiple Dimensions

```typescript
const result = await analytics.execute(Orders, {
  dimensions: ['country', 'status'],
  measures: ['revenue', 'count'],
});

console.log('Multi-dimension result:', result);
// Expected:
// {
//   data: [
//     { country: 'US', status: 'completed', revenue: 45000, count: 100 },
//     { country: 'US', status: 'pending', revenue: 5000, count: 20 },
//     { country: 'UK', status: 'completed', revenue: 28000, count: 80 }
//   ]
// }
```

### Test: Query with Order and Limit

```typescript
const result = await analytics.execute(Orders, {
  dimensions: ['country'],
  measures: ['revenue'],
  orderBy: [{ field: 'revenue', direction: 'desc' }],
  limit: 10,
});

console.log('Top 10 countries by revenue:', result.data);
```

### Test: Generate SQL without Executing

```typescript
const sql = analytics.toSQL(Orders, {
  dimensions: ['country'],
  measures: ['revenue'],
});

console.log('Generated SQL:', sql);
// Expected:
// SELECT country, SUM(amount) AS revenue
// FROM orders
// GROUP BY country
```

---

## Testing Metrics

### Test: Basic Metric

```typescript
const orderCount = Orders.metric('orderCount', {
  measure: 'count',
  label: 'Order Count',
});

const result = await analytics.execute(orderCount);

console.log('Total order count:', result.data);
// Expected:
// { data: [{ orderCount: 205 }] }
```

### Test: Metric with Dimensions

```typescript
const result = await analytics.execute(totalRevenue, {
  dimensions: ['country', 'status'],
});

console.log('Revenue breakdown:', result.data);
```

### Test: Metric with Filters

```typescript
const result = await analytics.execute(totalRevenue, {
  dimensions: ['country'],
  filters: [
    { field: 'status', operator: 'eq', value: 'completed' }
  ],
});

console.log('Completed orders revenue:', result.data);
```

---

## Testing Derived Metrics

Derived metrics combine multiple base metrics using formulas.

```typescript
import { divide, nullIfZero } from '@hypequery/datasets';

const avgOrderValue = Orders.metric('avgOrderValue', {
  uses: { totalRevenue, orderCount },
  formula: ({ totalRevenue, orderCount }) =>
    divide(totalRevenue, nullIfZero(orderCount)),
  label: 'Average Order Value',
});

const result = await analytics.execute(avgOrderValue, {
  dimensions: ['country'],
});

console.log('Average order value by country:', result.data);
// Expected:
// {
//   data: [
//     { country: 'US', avgOrderValue: 416.67 },
//     { country: 'UK', avgOrderValue: 352.94 }
//   ]
// }
```

### Test: Inspect Generated SQL for Derived Metrics

```typescript
const sql = analytics.toSQL(avgOrderValue, {
  dimensions: ['country'],
});

console.log('Derived metric SQL:', sql);
// Expected: CTE-based query with base metrics in WITH clause
// WITH base AS (
//   SELECT country,
//          SUM(amount) AS totalRevenue,
//          COUNT(id) AS orderCount
//   FROM orders
//   GROUP BY country
// )
// SELECT country,
//        totalRevenue / NULLIF(orderCount, 0) AS avgOrderValue
// FROM base
```

---

## Testing with Filters

### Test: Filter Validation

Datasets can define which operators are allowed for each filter:

```typescript
const OrdersWithFilters = dataset('orders', {
  source: 'orders',
  dimensions: {
    country: dimension.string(),
    status: dimension.string(),
    amount: dimension.number(),
  },
  measures: {
    revenue: measure.sum('amount'),
  },
  filters: {
    status: {
      __type: 'filter_definition',
      field: 'status',
      operators: ['eq', 'in'],  // Only allow eq and in
    },
    country: {
      __type: 'filter_definition',
      field: 'country',
      operators: ['eq'],  // Only allow eq
    },
  },
});

const revenue = OrdersWithFilters.metric('revenue', { measure: 'revenue' });

// This will work
const validResult = await analytics.execute(revenue, {
  filters: [
    { field: 'status', operator: 'eq', value: 'completed' }
  ],
});

// This will throw an error (operator not allowed)
try {
  await analytics.execute(revenue, {
    filters: [
      { field: 'status', operator: 'like', value: '%complete%' }
    ],
  });
} catch (error) {
  console.error('Expected error:', error.message);
  // Error: Filter "status" does not allow operator "like"
}
```

### Test: Multiple Filters

```typescript
const result = await analytics.execute(totalRevenue, {
  dimensions: ['country'],
  filters: [
    { field: 'status', operator: 'eq', value: 'completed' },
    { field: 'amount', operator: 'gte', value: 100 }
  ],
});

console.log('Filtered revenue:', result.data);
```

---

## Testing Time Graining

Time graining allows you to aggregate metrics by time periods.

### Test: Dataset with Time Key

```typescript
const OrdersWithTime = dataset('orders', {
  source: 'orders',
  timeKey: 'created_at',
  dimensions: {
    country: dimension.string(),
  },
  measures: {
    revenue: measure.sum('amount'),
  },
});

const revenue = OrdersWithTime.metric('revenue', { measure: 'revenue' });

// Daily revenue
const dailyResult = await analytics.execute(revenue, {
  by: 'day',
  orderBy: [{ field: 'period', direction: 'asc' }],
});

console.log('Daily revenue:', dailyResult.data);
// Expected:
// {
//   data: [
//     { period: '2024-01-01', revenue: 5000 },
//     { period: '2024-01-02', revenue: 7500 },
//     { period: '2024-01-03', revenue: 6200 }
//   ]
// }

// Monthly revenue
const monthlyResult = await analytics.execute(revenue, {
  by: 'month',
});

console.log('Monthly revenue:', monthlyResult.data);
// Expected:
// {
//   data: [
//     { period: '2024-01-01', revenue: 150000 },
//     { period: '2024-02-01', revenue: 180000 }
//   ]
// }
```

### Test: Grained Metric Refs

You can pre-grain a metric:

```typescript
const monthlyRevenue = revenue.by('month');

// Now it's always grained by month
const result = await analytics.execute(monthlyRevenue, {
  dimensions: ['country'],
});

console.log('Monthly revenue by country:', result.data);
// Expected:
// {
//   data: [
//     { country: 'US', period: '2024-01-01', monthlyRevenue: 120000 },
//     { country: 'UK', period: '2024-01-01', monthlyRevenue: 30000 }
//   ]
// }

// This will throw an error (conflicting grain)
try {
  await analytics.execute(monthlyRevenue, {
    by: 'week'  // ← Can't override the grain
  });
} catch (error) {
  console.error('Expected error:', error.message);
  // Error: Metric "revenue" is already grained by "month"
}
```

---

## Testing Tenant Isolation

Multi-tenant applications need to isolate data by tenant.

### Test: Dataset with Tenant Key

```typescript
const TenantOrders = dataset('tenant_orders', {
  source: 'orders',
  tenantKey: 'tenant_id',
  dimensions: {
    country: dimension.string(),
  },
  measures: {
    revenue: measure.sum('amount'),
  },
});

const tenantRevenue = TenantOrders.metric('revenue', { measure: 'revenue' });

// Execute with tenant context
const result = await analytics.execute(tenantRevenue, {
  dimensions: ['country'],
}, {
  tenantId: 'tenant-123',  // ← Runtime tenant isolation
});

console.log('Tenant-scoped revenue:', result.data);

// Check the generated SQL includes tenant filter
const sql = analytics.toSQL(tenantRevenue, {
  dimensions: ['country'],
}, {
  tenantId: 'tenant-123',
});

console.log('SQL with tenant filter:', sql);
// Expected to contain: WHERE tenant_id = 'tenant-123'
```

### Test: Validate Tenant Requirements

```typescript
// This will throw an error if dataset has tenantKey but no tenantId provided
try {
  await analytics.execute(tenantRevenue, {
    dimensions: ['country'],
  });  // ← Missing tenantId in context
} catch (error) {
  console.error('Expected error:', error.message);
  // Error: Dataset "tenant_orders" requires tenantId in execution context
}
```

### Test: Prevent Manual Tenant Filters

```typescript
const TenantOrdersWithFilter = dataset('tenant_orders', {
  source: 'orders',
  tenantKey: 'tenant_id',
  dimensions: {
    tenantId: dimension.string({ column: 'tenant_id' }),
    country: dimension.string(),
  },
  measures: {
    revenue: measure.sum('amount'),
  },
  filters: {
    tenantId: {
      __type: 'filter_definition',
      field: 'tenantId',
      operators: ['eq'],
    },
  },
});

// When runtime tenant isolation is active, manual tenant filters are rejected
try {
  await analytics.execute(tenantRevenue, {
    filters: [
      { field: 'tenantId', operator: 'eq', value: 'tenant-456' }
    ],
  }, {
    tenantId: 'tenant-123',
  });
} catch (error) {
  console.error('Expected error:', error.message);
  // Error: Cannot filter on tenant field "tenantId" when runtime tenant isolation is active
}
```

---

## Troubleshooting

### Issue: "Unknown dimension"

**Problem:**
```
Error: Unknown dimension "country_code". Available: country, status
```

**Solution:** Check that the dimension name matches your dataset definition exactly:
```typescript
const Orders = dataset('orders', {
  dimensions: {
    country: dimension.string(),  // ← Use 'country' in queries
    // NOT country_code
  },
});
```

### Issue: "Cannot filter on tenant field"

**Problem:**
```
Error: Cannot filter on tenant field "tenantId" when runtime tenant isolation is active
```

**Solution:** Don't include tenant field in filters when passing `tenantId` in execution context:
```typescript
// ✗ Wrong
await analytics.execute(metric, {
  filters: [{ field: 'tenantId', operator: 'eq', value: 'tenant-123' }]
}, { tenantId: 'tenant-123' });

// ✓ Correct
await analytics.execute(metric, {
  filters: []  // No tenant filter needed
}, { tenantId: 'tenant-123' });  // Tenant injected automatically
```

### Issue: "Filter does not allow operator"

**Problem:**
```
Error: Filter "status" does not allow operator "like"
```

**Solution:** Check your dataset's filter definitions and use only allowed operators:
```typescript
filters: {
  status: {
    __type: 'filter_definition',
    field: 'status',
    operators: ['eq', 'in'],  // ← Only these are allowed
  },
}
```

### Issue: "Metric is already grained"

**Problem:**
```
Error: Metric "revenue" is already grained by "month" and cannot be queried with by="week"
```

**Solution:** Don't specify `by` when using a pre-grained metric:
```typescript
const monthlyRevenue = revenue.by('month');

// ✗ Wrong
await analytics.execute(monthlyRevenue, { by: 'week' });

// ✓ Correct
await analytics.execute(monthlyRevenue);
```

### Issue: "Requires either queryBuilder or backend"

**Problem:**
```
Error: createDatasetClient requires either queryBuilder or backend.
```

**Solution:** Provide one of the two options:
```typescript
// Option 1: Use queryBuilder (recommended)
const analytics = createDatasetClient({
  queryBuilder: createQueryBuilder({ ... })
});

// Option 2: Use backend
const analytics = createDatasetClient({
  backend: createBackend({ ... })
});
```

---

## Running Full Test Suite

Create a test file `datasets.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { createDatasetClient } from '@hypequery/datasets';
import { createQueryBuilder } from '@hypequery/clickhouse';
import { dataset, dimension, measure, divide, nullIfZero } from '@hypequery/datasets';

const analytics = createDatasetClient({
  queryBuilder: createQueryBuilder({
    url: process.env.CLICKHOUSE_URL || 'http://localhost:8123',
    username: process.env.CLICKHOUSE_USER || 'default',
    password: process.env.CLICKHOUSE_PASSWORD || '',
    database: process.env.CLICKHOUSE_DATABASE || 'default',
  }),
});

const Orders = dataset('orders', {
  source: 'orders',
  timeKey: 'created_at',
  dimensions: {
    country: dimension.string(),
    status: dimension.string(),
  },
  measures: {
    revenue: measure.sum('amount'),
    count: measure.count('id'),
  },
});

const totalRevenue = Orders.metric('totalRevenue', { measure: 'revenue' });
const orderCount = Orders.metric('orderCount', { measure: 'count' });
const avgOrderValue = Orders.metric('avgOrderValue', {
  uses: { totalRevenue, orderCount },
  formula: ({ totalRevenue, orderCount }) =>
    divide(totalRevenue, nullIfZero(orderCount)),
});

describe('Datasets Integration Tests', () => {
  it('executes dataset query', async () => {
    const result = await analytics.execute(Orders, {
      dimensions: ['country'],
      measures: ['revenue'],
      limit: 10,
    });

    expect(result.data).toBeDefined();
    expect(Array.isArray(result.data)).toBe(true);
  });

  it('executes metric query', async () => {
    const result = await analytics.execute(totalRevenue, {
      dimensions: ['country'],
    });

    expect(result.data).toBeDefined();
    expect(result.data.length).toBeGreaterThan(0);
  });

  it('executes derived metric', async () => {
    const result = await analytics.execute(avgOrderValue, {
      dimensions: ['country'],
    });

    expect(result.data).toBeDefined();
  });

  it('validates filters', () => {
    const validation = analytics.validate(totalRevenue, {
      filters: [
        { field: 'unknown_field', operator: 'eq', value: 'test' }
      ],
    });

    expect(validation.valid).toBe(false);
    expect(validation.errors.length).toBeGreaterThan(0);
  });

  it('generates SQL', () => {
    const sql = analytics.toSQL(totalRevenue, {
      dimensions: ['country'],
    });

    expect(sql).toContain('SELECT');
    expect(sql).toContain('country');
  });
});
```

Run the tests:
```bash
npx vitest run datasets.test.ts
```

---

## Next Steps

1. **Test with real data**: Connect to your ClickHouse instance
2. **Add more datasets**: Define your business entities
3. **Create metrics**: Build your KPI library
4. **Expose via API**: Use `@hypequery/serve` to create HTTP endpoints
5. **Connect to MCP**: Use `@hypequery/mcp` to expose to AI agents

For HTTP API integration, see `@hypequery/serve` documentation.
For MCP integration, see `@hypequery/mcp` documentation.
