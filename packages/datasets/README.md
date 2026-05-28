# @hypequery/datasets

Type-safe semantic layer for ClickHouse with automatic query generation, relationship resolution, and multi-tenancy support.

[![npm version](https://img.shields.io/npm/v/@hypequery/datasets.svg)](https://www.npmjs.com/package/@hypequery/datasets)
[![License](https://img.shields.io/badge/license-Apache%202.0-blue.svg)](LICENSE)

## Features

- **Declarative Dataset DSL** - Define business metrics, dimensions, and measures in TypeScript
- **Automatic Query Generation** - Build complex SQL from simple field selections
- **Type Safety** - Full TypeScript inference for all dataset fields and relationships
- **Relationship Resolution** - Automatic JOIN generation with multi-hop support
- **Formula System** - Reusable calculated fields with dependency resolution
- **Multi-Tenancy** - Built-in support for tenant isolation and time-series queries
- **Query Validation** - Compile-time and runtime validation of field references
- **Flexible Execution** - Works with any ClickHouse client implementation

## Installation

```bash
npm install @hypequery/datasets
# or
pnpm add @hypequery/datasets
```

## Quick Start

### 1. Define Your Datasets

```typescript
// src/datasets/users.ts
import { defineDataset, dimension, measure, formula } from '@hypequery/datasets';

export const usersDataset = defineDataset({
  name: 'users',
  table: 'users',
  dimensions: {
    userId: dimension.number('id'),
    email: dimension.string('email'),
    name: dimension.string('name'),
    status: dimension.string('status'),
    createdAt: dimension.time('created_at'),
  },
  measures: {
    totalUsers: measure.count(),
    activeUsers: measure.countDistinct('id', {
      filter: "status = 'active'",
    }),
  },
});

export const ordersDataset = defineDataset({
  name: 'orders',
  table: 'orders',
  dimensions: {
    orderId: dimension.number('id'),
    userId: dimension.number('user_id'),
    amount: dimension.number('amount'),
    status: dimension.string('status'),
    createdAt: dimension.time('created_at'),
  },
  measures: {
    totalOrders: measure.count(),
    totalRevenue: measure.sum('amount'),
    averageOrderValue: measure.avg('amount'),
  },
  relationships: {
    user: {
      dataset: () => usersDataset,
      type: 'many-to-one',
      sql: 'orders.user_id = users.id',
    },
  },
});
```

### 2. Create Dataset Registry

```typescript
// src/datasets/index.ts
import { createDatasetRegistry } from '@hypequery/datasets';
import { usersDataset } from './users.js';
import { ordersDataset } from './orders.js';

export const registry = createDatasetRegistry({
  users: usersDataset,
  orders: ordersDataset,
});

export type Registry = typeof registry;
```

### 3. Execute Queries

```typescript
import { executeQuery } from '@hypequery/datasets';
import { registry } from './datasets/index.js';
import { createClient } from '@clickhouse/client';

const client = createClient({
  url: process.env.CLICKHOUSE_URL,
});

// Simple query with measures and dimensions
const result = await executeQuery({
  dataset: registry.datasets.orders,
  fields: [
    'orders.totalRevenue',
    'orders.totalOrders',
    'orders.createdAt',
  ],
  dimensions: ['orders.createdAt'],
  granularity: 'day',
  client,
});

// Query across relationships
const userOrderStats = await executeQuery({
  dataset: registry.datasets.orders,
  fields: [
    'orders.user.email',      // Automatic JOIN to users table
    'orders.totalRevenue',
    'orders.totalOrders',
  ],
  dimensions: ['orders.user.email'],
  client,
});
```

## Core Concepts

### Datasets

A **dataset** represents a business entity (users, orders, products) and defines:

- **Dimensions**: Attributes for grouping and filtering (strings, numbers, dates)
- **Measures**: Aggregations for analysis (counts, sums, averages)
- **Relationships**: Connections to other datasets (one-to-many, many-to-one)
- **Formulas**: Calculated fields derived from other fields

```typescript
const dataset = defineDataset({
  name: 'products',
  table: 'products',
  dimensions: {
    productId: dimension.number('id'),
    category: dimension.string('category'),
    price: dimension.number('price'),
  },
  measures: {
    productCount: measure.count(),
    averagePrice: measure.avg('price'),
  },
  relationships: {
    orders: {
      dataset: () => ordersDataset,
      type: 'one-to-many',
      sql: 'products.id = orders.product_id',
    },
  },
});
```

### Dimensions

Dimensions are attributes used for grouping, filtering, and segmentation:

```typescript
dimensions: {
  // Numeric dimensions
  userId: dimension.number('id'),
  age: dimension.number('age'),

  // String dimensions
  email: dimension.string('email'),
  status: dimension.string('status'),

  // Time dimensions (special handling for granularity)
  createdAt: dimension.time('created_at'),
  updatedAt: dimension.time('updated_at'),

  // Boolean dimensions
  isActive: dimension.boolean('is_active'),

  // Raw SQL dimensions
  monthYear: dimension.raw('toStartOfMonth(created_at)', 'Date'),
}
```

**Dimension Types:**
- `dimension.number(column)` - Numeric fields (Int, UInt, Float, Decimal)
- `dimension.string(column)` - String fields (String, LowCardinality)
- `dimension.time(column)` - Timestamp fields (DateTime, Date)
- `dimension.boolean(column)` - Boolean fields
- `dimension.raw(sql, type)` - Custom SQL expressions

### Measures

Measures are aggregations computed from dimension values:

```typescript
measures: {
  // Count measures
  totalUsers: measure.count(),
  activeUsers: measure.countDistinct('id', {
    filter: "status = 'active'",
  }),

  // Sum measures
  totalRevenue: measure.sum('amount'),
  totalRefunds: measure.sum('refund_amount', {
    filter: "status = 'refunded'",
  }),

  // Average measures
  averageOrderValue: measure.avg('amount'),

  // Min/Max measures
  minOrderAmount: measure.min('amount'),
  maxOrderAmount: measure.max('amount'),

  // Custom SQL measures
  medianAmount: measure.raw('quantile(0.5)(amount)', 'Float64'),
}
```

**Measure Types:**
- `measure.count()` - Count rows
- `measure.countDistinct(column, options?)` - Count unique values
- `measure.sum(column, options?)` - Sum values
- `measure.avg(column, options?)` - Average values
- `measure.min(column, options?)` - Minimum value
- `measure.max(column, options?)` - Maximum value
- `measure.raw(sql, type)` - Custom SQL aggregation

**Measure Options:**
- `filter`: SQL WHERE condition applied before aggregation
- `format`: Display formatting hint (e.g., 'currency', 'percent')

### Relationships

Relationships define how datasets connect, enabling automatic JOIN generation:

```typescript
relationships: {
  // Many-to-one: many orders belong to one user
  user: {
    dataset: () => usersDataset,
    type: 'many-to-one',
    sql: 'orders.user_id = users.id',
  },

  // One-to-many: one user has many orders
  orders: {
    dataset: () => ordersDataset,
    type: 'one-to-many',
    sql: 'users.id = orders.user_id',
  },

  // Many-to-many (through junction table)
  tags: {
    dataset: () => tagsDataset,
    type: 'many-to-many',
    through: 'product_tags',
    sql: 'products.id = product_tags.product_id AND product_tags.tag_id = tags.id',
  },
}
```

**Relationship Types:**
- `many-to-one`: Multiple rows in source relate to one row in target
- `one-to-many`: One row in source relates to multiple rows in target
- `many-to-many`: Multiple rows in source relate to multiple rows in target (requires `through`)

**Multi-Hop Queries:**

Relationships can be chained:

```typescript
const result = await executeQuery({
  dataset: ordersDataset,
  fields: [
    'orders.user.name',           // orders → users
    'orders.product.category',    // orders → products
    'orders.product.supplier.name', // orders → products → suppliers
    'orders.totalRevenue',
  ],
  dimensions: ['orders.product.category'],
  client,
});
```

### Formulas

Formulas are calculated fields derived from other fields:

```typescript
const ordersDataset = defineDataset({
  name: 'orders',
  // ... dimensions and measures
  formulas: {
    // Simple formula referencing measures
    averageOrderValue: formula(
      ({ measures }) => `${measures.totalRevenue} / ${measures.totalOrders}`,
      { dependencies: ['totalRevenue', 'totalOrders'] }
    ),

    // Formula with conditional logic
    conversionRate: formula(
      ({ measures }) => `
        CASE
          WHEN ${measures.totalVisits} > 0
          THEN ${measures.totalOrders} / ${measures.totalVisits}
          ELSE 0
        END
      `,
      { dependencies: ['totalOrders', 'totalVisits'] }
    ),

    // Formula using dimensions
    revenuePerUser: formula(
      ({ measures, dimensions }) => `
        ${measures.totalRevenue} / countDistinct(${dimensions.userId})
      `,
      { dependencies: ['totalRevenue', 'userId'] }
    ),
  },
});
```

**Formula Features:**
- Automatic dependency resolution
- Type-safe field references
- Support for complex SQL expressions
- Can reference measures, dimensions, and other formulas

## Query Execution

### Basic Queries

```typescript
import { executeQuery } from '@hypequery/datasets';

// Simple aggregation
const result = await executeQuery({
  dataset: ordersDataset,
  fields: ['orders.totalRevenue', 'orders.totalOrders'],
  client,
});

// With time dimension grouping
const dailyRevenue = await executeQuery({
  dataset: ordersDataset,
  fields: ['orders.createdAt', 'orders.totalRevenue'],
  dimensions: ['orders.createdAt'],
  granularity: 'day',
  client,
});
```

### Time-Series Queries

```typescript
// Group by month
const monthlyStats = await executeQuery({
  dataset: ordersDataset,
  fields: [
    'orders.createdAt',
    'orders.totalRevenue',
    'orders.totalOrders',
  ],
  dimensions: ['orders.createdAt'],
  granularity: 'month',
  dateRange: {
    start: '2024-01-01',
    end: '2024-12-31',
  },
  client,
});

// Group by week
const weeklyActive = await executeQuery({
  dataset: usersDataset,
  fields: [
    'users.createdAt',
    'users.activeUsers',
  ],
  dimensions: ['users.createdAt'],
  granularity: 'week',
  client,
});
```

**Supported Granularities:**
- `day` - Daily aggregation
- `week` - Weekly aggregation (Monday start)
- `month` - Monthly aggregation
- `quarter` - Quarterly aggregation
- `year` - Yearly aggregation

### Filtering

```typescript
// Simple filter
const activeUserOrders = await executeQuery({
  dataset: ordersDataset,
  fields: ['orders.totalRevenue'],
  filters: {
    'orders.user.status': { equals: 'active' },
  },
  client,
});

// Multiple filters
const filteredOrders = await executeQuery({
  dataset: ordersDataset,
  fields: ['orders.totalRevenue', 'orders.totalOrders'],
  filters: {
    'orders.status': { equals: 'completed' },
    'orders.amount': { greaterThan: 100 },
    'orders.createdAt': {
      between: ['2024-01-01', '2024-12-31'],
    },
  },
  client,
});
```

**Filter Operators:**
- `equals`: Exact match
- `notEquals`: Not equal
- `greaterThan`: Greater than (numbers, dates)
- `lessThan`: Less than (numbers, dates)
- `greaterThanOrEqual`: Greater than or equal
- `lessThanOrEqual`: Less than or equal
- `in`: Value in list
- `notIn`: Value not in list
- `contains`: String contains (LIKE '%value%')
- `startsWith`: String starts with (LIKE 'value%')
- `endsWith`: String ends with (LIKE '%value')
- `between`: Value between two values [start, end]

### Multi-Tenancy

```typescript
import { executeQueryWithTenant } from '@hypequery/datasets';

// Automatic tenant isolation
const tenantOrders = await executeQueryWithTenant({
  dataset: ordersDataset,
  fields: ['orders.totalRevenue', 'orders.totalOrders'],
  tenantId: 'acme-corp',
  tenantColumn: 'tenant_id', // Column in orders table
  client,
});

// With additional filters
const tenantStats = await executeQueryWithTenant({
  dataset: ordersDataset,
  fields: [
    'orders.createdAt',
    'orders.totalRevenue',
  ],
  dimensions: ['orders.createdAt'],
  granularity: 'month',
  tenantId: 'acme-corp',
  tenantColumn: 'tenant_id',
  filters: {
    'orders.status': { equals: 'completed' },
  },
  client,
});
```

### Sorting and Limiting

```typescript
// Sort by measure
const topProducts = await executeQuery({
  dataset: ordersDataset,
  fields: [
    'orders.product.name',
    'orders.totalRevenue',
  ],
  dimensions: ['orders.product.name'],
  orderBy: [
    { field: 'orders.totalRevenue', direction: 'desc' },
  ],
  limit: 10,
  client,
});

// Multiple sort columns
const sortedOrders = await executeQuery({
  dataset: ordersDataset,
  fields: [
    'orders.createdAt',
    'orders.user.email',
    'orders.totalRevenue',
  ],
  dimensions: ['orders.createdAt', 'orders.user.email'],
  orderBy: [
    { field: 'orders.createdAt', direction: 'desc' },
    { field: 'orders.totalRevenue', direction: 'desc' },
  ],
  limit: 100,
  offset: 0,
  client,
});
```

## Advanced Usage

### Custom SQL Dimensions and Measures

For complex calculations not covered by built-in types:

```typescript
const advancedDataset = defineDataset({
  name: 'analytics',
  table: 'events',
  dimensions: {
    // Complex date calculation
    businessWeek: dimension.raw(
      "toMonday(timestamp) + INTERVAL 1 DAY",
      'Date'
    ),

    // JSON field extraction
    userAgent: dimension.raw(
      "JSONExtractString(properties, 'user_agent')",
      'String'
    ),

    // Conditional dimension
    priceCategory: dimension.raw(`
      CASE
        WHEN price < 10 THEN 'budget'
        WHEN price < 100 THEN 'standard'
        ELSE 'premium'
      END
    `, 'String'),
  },
  measures: {
    // Percentile aggregation
    p95ResponseTime: measure.raw(
      'quantile(0.95)(response_time)',
      'Float64'
    ),

    // Unique with condition
    uniqueActiveUsers: measure.raw(`
      uniqIf(user_id, status = 'active')
    `, 'UInt64'),

    // Complex aggregation
    retentionRate: measure.raw(`
      countDistinct(user_id) / (
        SELECT countDistinct(user_id)
        FROM users
        WHERE created_at < toStartOfMonth(now())
      )
    `, 'Float64'),
  },
});
```

### Query Builder Pattern

```typescript
import { QueryBuilder } from '@hypequery/datasets';

const builder = new QueryBuilder(ordersDataset)
  .select('orders.totalRevenue')
  .select('orders.totalOrders')
  .select('orders.user.name')
  .groupBy('orders.user.name')
  .where('orders.status', { equals: 'completed' })
  .where('orders.amount', { greaterThan: 100 })
  .orderBy('orders.totalRevenue', 'desc')
  .limit(10);

const result = await builder.execute(client);
```

### Type-Safe Field References

```typescript
import type { DatasetFields } from '@hypequery/datasets';

// Extract available field types from dataset
type OrderFields = DatasetFields<typeof ordersDataset>;

// TypeScript will autocomplete and validate field names
const fields: OrderFields[] = [
  'orders.totalRevenue',   // ✓ Valid
  'orders.totalOrders',    // ✓ Valid
  'orders.invalid',        // ✗ Type error
];
```

### Dataset Compatibility Validation

```typescript
import { validateDatasetSchema } from '@hypequery/datasets';

// Validate dataset against ClickHouse schema
const validation = await validateDatasetSchema({
  dataset: ordersDataset,
  client,
});

if (!validation.valid) {
  console.error('Dataset validation failed:');
  for (const error of validation.errors) {
    console.error(`- ${error.field}: ${error.message}`);
  }
}
```

### Metrics Layer

Define reusable business metrics:

```typescript
import { defineMetric } from '@hypequery/datasets';

export const monthlyRecurringRevenue = defineMetric({
  name: 'Monthly Recurring Revenue',
  description: 'Total MRR from active subscriptions',
  dataset: subscriptionsDataset,
  measure: 'subscriptions.totalMRR',
  filters: {
    'subscriptions.status': { equals: 'active' },
  },
  format: 'currency',
});

export const churnRate = defineMetric({
  name: 'Monthly Churn Rate',
  description: 'Percentage of customers who cancelled this month',
  dataset: subscriptionsDataset,
  formula: formula(
    ({ measures }) => `
      (${measures.cancelledSubscriptions} / ${measures.activeSubscriptions}) * 100
    `,
    { dependencies: ['cancelledSubscriptions', 'activeSubscriptions'] }
  ),
  format: 'percent',
});

// Use metrics in queries
const result = await executeMetric(monthlyRecurringRevenue, {
  dimensions: ['subscriptions.createdAt'],
  granularity: 'month',
  client,
});
```

## API Reference

### Dataset Definition

#### `defineDataset(definition)`

Creates a dataset with dimensions, measures, relationships, and formulas.

**Parameters:**
- `definition.name`: Dataset name (string)
- `definition.table`: Source table name (string)
- `definition.dimensions`: Record of dimension definitions
- `definition.measures`: Record of measure definitions
- `definition.relationships?`: Record of relationship definitions
- `definition.formulas?`: Record of formula definitions

**Returns:** `Dataset<...>` with full type inference

#### `dimension` Object

Factory methods for dimension types:

- `dimension.number(column)` - Numeric dimension
- `dimension.string(column)` - String dimension
- `dimension.time(column)` - Time dimension
- `dimension.boolean(column)` - Boolean dimension
- `dimension.raw(sql, type)` - Custom SQL dimension

#### `measure` Object

Factory methods for measure types:

- `measure.count()` - Count rows
- `measure.countDistinct(column, options?)` - Count unique values
- `measure.sum(column, options?)` - Sum values
- `measure.avg(column, options?)` - Average values
- `measure.min(column, options?)` - Minimum value
- `measure.max(column, options?)` - Maximum value
- `measure.raw(sql, type)` - Custom SQL aggregation

#### `formula(fn, options)`

Creates a calculated field from other fields.

**Parameters:**
- `fn`: Function receiving `{ measures, dimensions, formulas }` and returning SQL
- `options.dependencies`: Array of field names this formula depends on

**Returns:** Formula definition

### Query Execution

#### `executeQuery(options)`

Executes a query and returns results.

**Parameters:**
- `options.dataset`: Dataset to query
- `options.fields`: Array of field references (e.g., `['orders.totalRevenue']`)
- `options.dimensions?`: Array of dimension references for GROUP BY
- `options.filters?`: Record of filter conditions
- `options.granularity?`: Time granularity (`'day'`, `'week'`, `'month'`, `'quarter'`, `'year'`)
- `options.dateRange?`: `{ start: string, end: string }`
- `options.orderBy?`: Array of `{ field: string, direction: 'asc' | 'desc' }`
- `options.limit?`: Maximum rows to return
- `options.offset?`: Number of rows to skip
- `options.client`: ClickHouse client

**Returns:** `Promise<QueryResult<T>>` with typed rows

#### `executeQueryWithTenant(options)`

Executes a query with automatic tenant isolation.

**Parameters:**
- All parameters from `executeQuery()`
- `options.tenantId`: Tenant identifier
- `options.tenantColumn`: Column name for tenant filtering

**Returns:** `Promise<QueryResult<T>>`

### Registry

#### `createDatasetRegistry(datasets)`

Creates a registry for managing multiple datasets.

**Parameters:**
- `datasets`: Record of dataset definitions

**Returns:** Registry with `.datasets` property and helper methods

## Best Practices

### 1. Use Descriptive Field Names

```typescript
// ✅ Good - clear business meaning
measures: {
  monthlyRecurringRevenue: measure.sum('mrr_amount'),
  activeSubscriptionCount: measure.countDistinct('subscription_id', {
    filter: "status = 'active'",
  }),
}

// ❌ Avoid - unclear abbreviations
measures: {
  mrr: measure.sum('amount'),
  cnt: measure.count(),
}
```

### 2. Document Complex Formulas

```typescript
formulas: {
  // Customer lifetime value = average order value × purchase frequency × customer lifespan
  customerLifetimeValue: formula(
    ({ measures }) => `
      (${measures.totalRevenue} / ${measures.totalOrders}) *
      (${measures.totalOrders} / ${measures.uniqueCustomers}) *
      ${measures.averageCustomerLifespanDays}
    `,
    { dependencies: ['totalRevenue', 'totalOrders', 'uniqueCustomers', 'averageCustomerLifespanDays'] }
  ),
}
```

### 3. Use Filters in Measure Definitions

```typescript
// ✅ Good - filter at measure level for reusability
measures: {
  completedOrders: measure.count({
    filter: "status = 'completed'",
  }),
  cancelledOrders: measure.count({
    filter: "status = 'cancelled'",
  }),
}

// ❌ Avoid - repeating filters in every query
// This makes queries verbose and error-prone
```

### 4. Optimize Relationships

```typescript
// ✅ Good - specific JOIN condition
relationships: {
  user: {
    dataset: () => usersDataset,
    type: 'many-to-one',
    sql: 'orders.user_id = users.id AND users.deleted_at IS NULL',
  },
}

// ❌ Avoid - missing important conditions
relationships: {
  user: {
    dataset: () => usersDataset,
    type: 'many-to-one',
    sql: 'orders.user_id = users.id', // May include deleted users
  },
}
```

### 5. Validate Datasets in Tests

```typescript
import { describe, it, expect } from 'vitest';
import { validateDatasetSchema } from '@hypequery/datasets';

describe('Dataset Validation', () => {
  it('should have all fields present in ClickHouse', async () => {
    const validation = await validateDatasetSchema({
      dataset: ordersDataset,
      client,
    });

    expect(validation.valid).toBe(true);
    expect(validation.errors).toHaveLength(0);
  });
});
```

## Troubleshooting

### Query Generation Issues

**Problem:** Generated SQL has syntax errors

**Solution:** Use `buildQuery()` to inspect generated SQL:

```typescript
import { buildQuery } from '@hypequery/datasets';

const query = buildQuery({
  dataset: ordersDataset,
  fields: ['orders.totalRevenue'],
  dimensions: ['orders.createdAt'],
  granularity: 'day',
});

console.log('Generated SQL:', query.sql);
console.log('Parameters:', query.parameters);
```

### Relationship Not Resolving

**Problem:** Field like `orders.user.email` throws error

**Solution:** Ensure relationship is defined with correct direction:

```typescript
// In ordersDataset
relationships: {
  user: {
    dataset: () => usersDataset,
    type: 'many-to-one', // Must match relationship direction
    sql: 'orders.user_id = users.id',
  },
}
```

### Type Inference Not Working

**Problem:** TypeScript doesn't autocomplete field names

**Solution:** Ensure registry is properly typed:

```typescript
// Export registry type
export const registry = createDatasetRegistry({ orders, users });
export type Registry = typeof registry;

// Import and use
import type { Registry } from './datasets';

function queryOrders(registry: Registry) {
  // Now TypeScript knows about all fields
  return executeQuery({
    dataset: registry.datasets.orders,
    fields: ['orders.totalRevenue'], // ✓ Autocompletes
    client,
  });
}
```

### Performance Issues

**Problem:** Queries are slow with large datasets

**Solution:** Add indexes and optimize filters:

```sql
-- In ClickHouse
CREATE INDEX idx_user_id ON orders (user_id) TYPE minmax GRANULARITY 4;
CREATE INDEX idx_status ON orders (status) TYPE set(100) GRANULARITY 1;
```

Also consider:
- Use `limit` to cap result size
- Add selective filters to reduce scan range
- Use `countDistinct` with caution on high-cardinality columns
- Partition large tables by date range

## Contributing

We welcome contributions! Please see [CONTRIBUTING.md](../../CONTRIBUTING.md) for guidelines.

## License

Apache 2.0 - see [LICENSE](../../LICENSE) for details.

## Links

- [Documentation](https://hypequery.com/docs)
- [GitHub Repository](https://github.com/hypequery/hypequery)
- [Issue Tracker](https://github.com/hypequery/hypequery/issues)
- [npm Package](https://www.npmjs.com/package/@hypequery/datasets)
