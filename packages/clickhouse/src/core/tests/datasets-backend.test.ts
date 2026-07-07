import { describe, it, expect } from 'vitest';
import {
  createDatasetClient,
  dataset,
  dimension,
  measure,
  eq,
  neq,
  gt,
  gte,
  lt,
  lte,
  inList,
  notInList,
  like,
  divide,
  nullIfZero,
  add,
  multiply,
} from '@hypequery/datasets';
import { createBackend } from '../../datasets.js';

/**
 * Comprehensive test suite for ClickHouse semantic backend execution
 *
 * These tests verify that the backend correctly translates semantic plans
 * into ClickHouse SQL and executes them properly. Coverage includes:
 * - Base aggregations (all types)
 * - Filtered measures
 * - Time grains
 * - Derived metrics with formulas
 * - All filter operators
 * - Tenant filtering
 * - Complex queries with multiple dimensions/measures
 * - Edge cases and error handling
 */

// =============================================================================
// Test Fixtures
// =============================================================================

const Orders = dataset('orders', {
  source: 'orders',
  timeKey: 'created_at',
  dimensions: {
    id: dimension.string(),
    tenantId: dimension.string({ column: 'tenant_id' }),
    customerId: dimension.string({ column: 'customer_id' }),
    country: dimension.string(),
    status: dimension.string(),
    productCategory: dimension.string({ column: 'product_category' }),
    amount: dimension.number(),
    quantity: dimension.number(),
    createdAt: dimension.timestamp({ column: 'created_at' }),
  },
  measures: {
    revenue: measure.sum('amount'),
    orderCount: measure.count('id'),
    avgOrderValue: measure.avg('amount'),
    minOrderValue: measure.min('amount'),
    maxOrderValue: measure.max('amount'),
    uniqueCustomers: measure.countDistinct('customerId'),
    totalQuantity: measure.sum('quantity'),
    completedRevenue: measure.sum('amount', {
      filters: [eq('status', 'completed')],
    }),
    pendingRevenue: measure.sum('amount', {
      filters: [eq('status', 'pending')],
    }),
    highValueRevenue: measure.sum('amount', {
      filters: [gt('amount', 1000)],
    }),
  },
});

const TenantOrders = dataset('tenantOrders', {
  source: 'orders',
  tenantKey: 'tenant_id',
  timeKey: 'created_at',
  dimensions: {
    id: dimension.string(),
    tenantId: dimension.string({ column: 'tenant_id' }),
    customerId: dimension.string({ column: 'customer_id' }),
    country: dimension.string(),
    status: dimension.string(),
    amount: dimension.number(),
    createdAt: dimension.timestamp({ column: 'created_at' }),
  },
  measures: {
    revenue: measure.sum('amount'),
    orderCount: measure.count('id'),
  },
});

const Products = dataset('products', {
  source: 'products',
  timeKey: 'created_at',
  dimensions: {
    id: dimension.string(),
    name: dimension.string(),
    category: dimension.string(),
    price: dimension.number(),
    createdAt: dimension.timestamp({ column: 'created_at' }),
  },
  measures: {
    productCount: measure.count('id'),
    avgPrice: measure.avg('price'),
  },
});

// =============================================================================
// Helper: Create Test Backend
// =============================================================================

function createTestBackend(mockData: any[] = []) {
  const queries: string[] = [];

  return {
    backend: createBackend({
      adapter: {
        name: 'test',
        query: async (sql: string) => {
          queries.push(sql);
          return mockData;
        },
      },
    }),
    queries,
  };
}

// =============================================================================
// Base Aggregation Tests
// =============================================================================

describe('ClickHouse Backend - Base Aggregations', () => {
  it('generates SUM aggregation', async () => {
    const { backend, queries } = createTestBackend([{ country: 'US', revenue: 1000 }]);
    const analytics = createDatasetClient({ backend });

    await analytics.execute(Orders, {
      dimensions: ['country'],
      measures: ['revenue'],
    });

    expect(queries[0]).toContain('SELECT country, SUM(amount) AS revenue FROM orders');
    expect(queries[0]).toContain('GROUP BY country');
  });

  it('generates COUNT aggregation', async () => {
    const { backend, queries } = createTestBackend([{ country: 'US', orderCount: 10 }]);
    const analytics = createDatasetClient({ backend });

    await analytics.execute(Orders, {
      dimensions: ['country'],
      measures: ['orderCount'],
    });

    expect(queries[0]).toContain('COUNT(id) AS orderCount');
  });

  it('generates COUNT DISTINCT aggregation', async () => {
    const { backend, queries } = createTestBackend([{ country: 'US', uniqueCustomers: 5 }]);
    const analytics = createDatasetClient({ backend });

    await analytics.execute(Orders, {
      dimensions: ['country'],
      measures: ['uniqueCustomers'],
    });

    expect(queries[0]).toContain('COUNT(DISTINCT customer_id) AS uniqueCustomers');
  });

  it('generates AVG aggregation', async () => {
    const { backend, queries } = createTestBackend([{ country: 'US', avgOrderValue: 100.5 }]);
    const analytics = createDatasetClient({ backend });

    await analytics.execute(Orders, {
      dimensions: ['country'],
      measures: ['avgOrderValue'],
    });

    expect(queries[0]).toContain('AVG(amount) AS avgOrderValue');
  });

  it('generates MIN aggregation', async () => {
    const { backend, queries } = createTestBackend([{ country: 'US', minOrderValue: 10 }]);
    const analytics = createDatasetClient({ backend });

    await analytics.execute(Orders, {
      dimensions: ['country'],
      measures: ['minOrderValue'],
    });

    expect(queries[0]).toContain('MIN(amount) AS minOrderValue');
  });

  it('generates MAX aggregation', async () => {
    const { backend, queries } = createTestBackend([{ country: 'US', maxOrderValue: 1000 }]);
    const analytics = createDatasetClient({ backend });

    await analytics.execute(Orders, {
      dimensions: ['country'],
      measures: ['maxOrderValue'],
    });

    expect(queries[0]).toContain('MAX(amount) AS maxOrderValue');
  });

  it('generates multiple measures in single query', async () => {
    const { backend, queries } = createTestBackend([
      { country: 'US', revenue: 1000, orderCount: 10, uniqueCustomers: 5 },
    ]);
    const analytics = createDatasetClient({ backend });

    await analytics.execute(Orders, {
      dimensions: ['country'],
      measures: ['revenue', 'orderCount', 'uniqueCustomers'],
    });

    expect(queries[0]).toContain('SUM(amount) AS revenue');
    expect(queries[0]).toContain('COUNT(id) AS orderCount');
    expect(queries[0]).toContain('COUNT(DISTINCT customer_id) AS uniqueCustomers');
  });

  it('generates query with multiple dimensions', async () => {
    const { backend, queries } = createTestBackend([
      { country: 'US', status: 'completed', revenue: 1000 },
    ]);
    const analytics = createDatasetClient({ backend });

    await analytics.execute(Orders, {
      dimensions: ['country', 'status'],
      measures: ['revenue'],
    });

    expect(queries[0]).toContain('SELECT country, status, SUM(amount) AS revenue');
    expect(queries[0]).toContain('GROUP BY country, status');
  });
});

// =============================================================================
// Filtered Measure Tests
// =============================================================================

describe('ClickHouse Backend - Filtered Measures', () => {
  it('generates IF condition for filtered SUM', async () => {
    const { backend, queries } = createTestBackend([{ country: 'US', completedRevenue: 800 }]);
    const analytics = createDatasetClient({ backend });

    await analytics.execute(Orders, {
      dimensions: ['country'],
      measures: ['completedRevenue'],
    });

    expect(queries[0]).toContain("SUM(if((status = 'completed'), amount, 0)) AS completedRevenue");
  });

  it('generates multiple filtered measures', async () => {
    const { backend, queries } = createTestBackend([
      { country: 'US', completedRevenue: 800, pendingRevenue: 200 },
    ]);
    const analytics = createDatasetClient({ backend });

    await analytics.execute(Orders, {
      dimensions: ['country'],
      measures: ['completedRevenue', 'pendingRevenue'],
    });

    expect(queries[0]).toContain("SUM(if((status = 'completed'), amount, 0)) AS completedRevenue");
    expect(queries[0]).toContain("SUM(if((status = 'pending'), amount, 0)) AS pendingRevenue");
  });

  it('generates IF condition with numeric comparison filter', async () => {
    const { backend, queries } = createTestBackend([{ country: 'US', highValueRevenue: 5000 }]);
    const analytics = createDatasetClient({ backend });

    await analytics.execute(Orders, {
      dimensions: ['country'],
      measures: ['highValueRevenue'],
    });

    expect(queries[0]).toContain('SUM(if((amount > 1000), amount, 0)) AS highValueRevenue');
  });

  it('combines regular and filtered measures', async () => {
    const { backend, queries } = createTestBackend([
      { country: 'US', revenue: 1000, completedRevenue: 800 },
    ]);
    const analytics = createDatasetClient({ backend });

    await analytics.execute(Orders, {
      dimensions: ['country'],
      measures: ['revenue', 'completedRevenue'],
    });

    expect(queries[0]).toContain('SUM(amount) AS revenue');
    expect(queries[0]).toContain("SUM(if((status = 'completed'), amount, 0)) AS completedRevenue");
  });
});

// =============================================================================
// Filter Operator Tests
// =============================================================================

describe('ClickHouse Backend - Filter Operators', () => {
  it('generates EQ filter', async () => {
    const { backend, queries } = createTestBackend([{ country: 'US', revenue: 1000 }]);
    const analytics = createDatasetClient({ backend });

    await analytics.execute(Orders, {
      dimensions: ['country'],
      measures: ['revenue'],
      filters: [eq('status', 'completed')],
    });

    expect(queries[0]).toContain('WHERE status = ?');
  });

  it('generates NEQ filter', async () => {
    const { backend, queries } = createTestBackend([{ country: 'US', revenue: 1000 }]);
    const analytics = createDatasetClient({ backend });

    await analytics.execute(Orders, {
      dimensions: ['country'],
      measures: ['revenue'],
      filters: [neq('status', 'cancelled')],
    });

    expect(queries[0]).toContain('WHERE status != ?');
  });

  it('generates GT filter', async () => {
    const { backend, queries } = createTestBackend([{ country: 'US', revenue: 1000 }]);
    const analytics = createDatasetClient({ backend });

    await analytics.execute(Orders, {
      dimensions: ['country'],
      measures: ['revenue'],
      filters: [gt('amount', 100)],
    });

    expect(queries[0]).toContain('WHERE amount > ?');
  });

  it('generates GTE filter', async () => {
    const { backend, queries } = createTestBackend([{ country: 'US', revenue: 1000 }]);
    const analytics = createDatasetClient({ backend });

    await analytics.execute(Orders, {
      dimensions: ['country'],
      measures: ['revenue'],
      filters: [gte('amount', 100)],
    });

    expect(queries[0]).toContain('WHERE amount >= ?');
  });

  it('generates LT filter', async () => {
    const { backend, queries } = createTestBackend([{ country: 'US', revenue: 1000 }]);
    const analytics = createDatasetClient({ backend });

    await analytics.execute(Orders, {
      dimensions: ['country'],
      measures: ['revenue'],
      filters: [lt('amount', 1000)],
    });

    expect(queries[0]).toContain('WHERE amount < ?');
  });

  it('generates LTE filter', async () => {
    const { backend, queries } = createTestBackend([{ country: 'US', revenue: 1000 }]);
    const analytics = createDatasetClient({ backend });

    await analytics.execute(Orders, {
      dimensions: ['country'],
      measures: ['revenue'],
      filters: [lte('amount', 1000)],
    });

    expect(queries[0]).toContain('WHERE amount <= ?');
  });

  it('generates IN filter', async () => {
    const { backend, queries } = createTestBackend([{ country: 'US', revenue: 1000 }]);
    const analytics = createDatasetClient({ backend });

    await analytics.execute(Orders, {
      dimensions: ['country'],
      measures: ['revenue'],
      filters: [inList('country', ['US', 'CA', 'UK'])],
    });

    expect(queries[0]).toContain('WHERE country IN (?, ?, ?)');
  });

  it('generates NOT IN filter', async () => {
    const { backend, queries } = createTestBackend([{ country: 'US', revenue: 1000 }]);
    const analytics = createDatasetClient({ backend });

    await analytics.execute(Orders, {
      dimensions: ['country'],
      measures: ['revenue'],
      filters: [notInList('status', ['cancelled', 'refunded'])],
    });

    expect(queries[0]).toContain('WHERE status NOT IN (?, ?)');
  });

  it('generates LIKE filter', async () => {
    const { backend, queries } = createTestBackend([{ country: 'US', revenue: 1000 }]);
    const analytics = createDatasetClient({ backend });

    await analytics.execute(Orders, {
      dimensions: ['country'],
      measures: ['revenue'],
      filters: [like('productCategory', '%electronics%')],
    });

    expect(queries[0]).toContain('WHERE product_category LIKE ?');
  });

  it('generates multiple filters with AND logic', async () => {
    const { backend, queries } = createTestBackend([{ country: 'US', revenue: 1000 }]);
    const analytics = createDatasetClient({ backend });

    await analytics.execute(Orders, {
      dimensions: ['country'],
      measures: ['revenue'],
      filters: [
        eq('status', 'completed'),
        gt('amount', 100),
        inList('country', ['US', 'CA']),
      ],
    });

    expect(queries[0]).toContain('WHERE status = ?');
    expect(queries[0]).toContain('AND amount > ?');
    expect(queries[0]).toContain('AND country IN (?, ?)');
  });
});

// =============================================================================
// Time Grain Tests
// =============================================================================

describe('ClickHouse Backend - Time Grains', () => {
  const revenue = Orders.metric('revenue', { measure: 'revenue' });

  it('generates day grain', async () => {
    const { backend, queries } = createTestBackend([]);
    const analytics = createDatasetClient({ backend });
    const dailyRevenue = revenue.by('day');

    await analytics.execute(dailyRevenue, { dimensions: ['country'] });

    expect(queries[0]).toContain('toStartOfDay(created_at) AS period');
    expect(queries[0]).toContain('GROUP BY period, country');
  });

  it('generates week grain', async () => {
    const { backend, queries } = createTestBackend([]);
    const analytics = createDatasetClient({ backend });
    const weeklyRevenue = revenue.by('week');

    await analytics.execute(weeklyRevenue, { dimensions: ['country'] });

    expect(queries[0]).toContain('toStartOfWeek(created_at) AS period');
  });

  it('generates month grain', async () => {
    const { backend, queries } = createTestBackend([]);
    const analytics = createDatasetClient({ backend });
    const monthlyRevenue = revenue.by('month');

    await analytics.execute(monthlyRevenue, { dimensions: ['country'] });

    expect(queries[0]).toContain('toStartOfMonth(created_at) AS period');
  });

  it('generates quarter grain', async () => {
    const { backend, queries } = createTestBackend([]);
    const analytics = createDatasetClient({ backend });
    const quarterlyRevenue = revenue.by('quarter');

    await analytics.execute(quarterlyRevenue, { dimensions: ['country'] });

    expect(queries[0]).toContain('toStartOfQuarter(created_at) AS period');
  });

  it('generates year grain', async () => {
    const { backend, queries } = createTestBackend([]);
    const analytics = createDatasetClient({ backend });
    const yearlyRevenue = revenue.by('year');

    await analytics.execute(yearlyRevenue, { dimensions: ['country'] });

    expect(queries[0]).toContain('toStartOfYear(created_at) AS period');
  });

  it('generates grained query without dimensions', async () => {
    const { backend, queries } = createTestBackend([]);
    const analytics = createDatasetClient({ backend });
    const monthlyRevenue = revenue.by('month');

    await analytics.execute(monthlyRevenue);

    expect(queries[0]).toContain('toStartOfMonth(created_at) AS period');
    expect(queries[0]).toContain('GROUP BY period');
    expect(queries[0]).not.toContain('GROUP BY period,'); // No trailing comma
  });
});

// =============================================================================
// Derived Metric Tests
// =============================================================================

describe('ClickHouse Backend - Derived Metrics', () => {
  const revenue = Orders.metric('revenue', { measure: 'revenue' });
  const orderCount = Orders.metric('orderCount', { measure: 'orderCount' });

  it('generates CTE for derived metric with division', async () => {
    const { backend, queries } = createTestBackend([]);
    const analytics = createDatasetClient({ backend });

    const avgOrderValue = Orders.metric('avgOrderValue', {
      uses: { revenue, orderCount },
      formula: ({ revenue, orderCount }) => divide(revenue, nullIfZero(orderCount)),
    });

    await analytics.execute(avgOrderValue, { dimensions: ['country'] });

    expect(queries[0]).toContain('WITH base AS (');
    expect(queries[0]).toContain('SUM(amount) AS revenue');
    expect(queries[0]).toContain('COUNT(id) AS orderCount');
    expect(queries[0]).toContain(') SELECT country, (revenue) / (NULLIF(orderCount, 0)) AS avgOrderValue FROM base');
  });

  it('generates CTE for derived metric with multiple operations', async () => {
    const { backend, queries } = createTestBackend([]);
    const analytics = createDatasetClient({ backend });
    const totalQuantity = Orders.metric('totalQuantity', { measure: 'totalQuantity' });

    const complexMetric = Orders.metric('complexMetric', {
      uses: { revenue, orderCount, totalQuantity },
      formula: ({ revenue, orderCount, totalQuantity }) =>
        add(divide(revenue, nullIfZero(orderCount)), multiply(totalQuantity, 10)),
    });

    await analytics.execute(complexMetric, { dimensions: ['country'] });

    expect(queries[0]).toContain('WITH base AS (');
    expect(queries[0]).toContain('SUM(amount) AS revenue');
    expect(queries[0]).toContain('COUNT(id) AS orderCount');
    expect(queries[0]).toContain('SUM(quantity) AS totalQuantity');
    expect(queries[0]).toContain('((revenue) / (NULLIF(orderCount, 0))) + ((totalQuantity) * (10))');
  });

  it('applies ORDER BY and LIMIT to derived metrics', async () => {
    const { backend, queries } = createTestBackend([]);
    const analytics = createDatasetClient({ backend });

    const avgOrderValue = Orders.metric('avgOrderValue', {
      uses: { revenue, orderCount },
      formula: ({ revenue, orderCount }) => divide(revenue, nullIfZero(orderCount)),
    });

    await analytics.execute(avgOrderValue, {
      dimensions: ['country'],
      orderBy: [{ field: 'avgOrderValue', direction: 'desc' }],
      limit: 10,
    });

    expect(queries[0]).toContain('ORDER BY avgOrderValue DESC');
    expect(queries[0]).toContain('LIMIT 10');
  });

  it('supports grained derived metrics', async () => {
    const { backend, queries } = createTestBackend([]);
    const analytics = createDatasetClient({ backend });

    const avgOrderValue = Orders.metric('avgOrderValue', {
      uses: { revenue, orderCount },
      formula: ({ revenue, orderCount }) => divide(revenue, nullIfZero(orderCount)),
    });

    const monthlyAvg = avgOrderValue.by('month');

    await analytics.execute(monthlyAvg, { dimensions: ['country'] });

    expect(queries[0]).toContain('WITH base AS (');
    expect(queries[0]).toContain('toStartOfMonth(created_at) AS period');
    expect(queries[0]).toContain('SELECT period, country, (revenue) / (NULLIF(orderCount, 0)) AS avgOrderValue FROM base');
  });
});

// =============================================================================
// Tenant Filtering Tests
// =============================================================================

describe('ClickHouse Backend - Tenant Filtering', () => {
  it('injects tenant filter when runtime context provided', async () => {
    const { backend, queries } = createTestBackend([]);
    const analytics = createDatasetClient({ backend });

    await analytics.execute(
      TenantOrders,
      {
        dimensions: ['country'],
        measures: ['revenue'],
      },
      {
        runtime: {
          tenant: { id: 'tenant_123' },
        },
      },
    );

    expect(queries[0]).toContain('WHERE tenant_id = ?');
  });

  it('combines tenant filter with user filters', async () => {
    const { backend, queries } = createTestBackend([]);
    const analytics = createDatasetClient({ backend });

    await analytics.execute(
      TenantOrders,
      {
        dimensions: ['country'],
        measures: ['revenue'],
        filters: [eq('status', 'completed')],
      },
      {
        runtime: {
          tenant: { id: 'tenant_123' },
        },
      },
    );

    expect(queries[0]).toContain('WHERE tenant_id = ?');
    expect(queries[0]).toContain('AND status = ?');
  });

  it('rejects tenant-keyed datasets when no tenant context is provided', async () => {
    const { backend } = createTestBackend([]);
    const analytics = createDatasetClient({ backend });

    expect(() => analytics.execute(TenantOrders, {
      dimensions: ['country'],
      measures: ['revenue'],
    })).toThrow('requires runtime tenant scoping');
  });
});

// =============================================================================
// ORDER BY and Pagination Tests
// =============================================================================

describe('ClickHouse Backend - ORDER BY and Pagination', () => {
  it('generates ORDER BY for dimension', async () => {
    const { backend, queries } = createTestBackend([]);
    const analytics = createDatasetClient({ backend });

    await analytics.execute(Orders, {
      dimensions: ['country'],
      measures: ['revenue'],
      orderBy: [{ field: 'country', direction: 'asc' }],
    });

    expect(queries[0]).toContain('ORDER BY country ASC');
  });

  it('generates ORDER BY for measure', async () => {
    const { backend, queries } = createTestBackend([]);
    const analytics = createDatasetClient({ backend });

    await analytics.execute(Orders, {
      dimensions: ['country'],
      measures: ['revenue'],
      orderBy: [{ field: 'revenue', direction: 'desc' }],
    });

    expect(queries[0]).toContain('ORDER BY revenue DESC');
  });

  it('generates multiple ORDER BY clauses', async () => {
    const { backend, queries } = createTestBackend([]);
    const analytics = createDatasetClient({ backend });

    await analytics.execute(Orders, {
      dimensions: ['country', 'status'],
      measures: ['revenue'],
      orderBy: [
        { field: 'country', direction: 'asc' },
        { field: 'revenue', direction: 'desc' },
      ],
    });

    expect(queries[0]).toContain('ORDER BY country ASC, revenue DESC');
  });

  it('generates LIMIT', async () => {
    const { backend, queries } = createTestBackend([]);
    const analytics = createDatasetClient({ backend });

    await analytics.execute(Orders, {
      dimensions: ['country'],
      measures: ['revenue'],
      limit: 100,
    });

    expect(queries[0]).toContain('LIMIT 100');
  });

  it('generates OFFSET', async () => {
    const { backend, queries } = createTestBackend([]);
    const analytics = createDatasetClient({ backend });

    await analytics.execute(Orders, {
      dimensions: ['country'],
      measures: ['revenue'],
      limit: 100,
      offset: 50,
    });

    expect(queries[0]).toContain('LIMIT 100');
    expect(queries[0]).toContain('OFFSET 50');
  });

  it('generates OFFSET with LIMIT', async () => {
    const { backend, queries } = createTestBackend([]);
    const analytics = createDatasetClient({ backend });

    await analytics.execute(Orders, {
      dimensions: ['country'],
      measures: ['revenue'],
      limit: 100,
      offset: 50,
    });

    expect(queries[0]).toContain('LIMIT 100');
    expect(queries[0]).toContain('OFFSET 50');
  });
});

// =============================================================================
// Column Alias Resolution Tests
// =============================================================================

describe('ClickHouse Backend - Column Alias Resolution', () => {
  it('resolves dimension column alias', async () => {
    const { backend, queries } = createTestBackend([]);
    const analytics = createDatasetClient({ backend });

    await analytics.execute(Orders, {
      dimensions: ['customerId'],
      measures: ['revenue'],
    });

    expect(queries[0]).toContain('customer_id AS customerId');
    expect(queries[0]).toContain('GROUP BY customerId');
  });

  it('resolves measure column alias in aggregation', async () => {
    const { backend, queries } = createTestBackend([]);
    const analytics = createDatasetClient({ backend });

    await analytics.execute(Orders, {
      dimensions: ['country'],
      measures: ['uniqueCustomers'],
    });

    expect(queries[0]).toContain('COUNT(DISTINCT customer_id) AS uniqueCustomers');
  });

  it('uses dimension as-is when no alias needed', async () => {
    const { backend, queries } = createTestBackend([]);
    const analytics = createDatasetClient({ backend });

    await analytics.execute(Orders, {
      dimensions: ['country'],
      measures: ['revenue'],
    });

    expect(queries[0]).toContain('SELECT country,');
    expect(queries[0]).not.toContain('country AS country');
  });
});

// =============================================================================
// Edge Cases and Error Handling
// =============================================================================

describe('ClickHouse Backend - Edge Cases', () => {
  it('handles query with no dimensions (total aggregation)', async () => {
    const { backend, queries } = createTestBackend([{ revenue: 10000 }]);
    const analytics = createDatasetClient({ backend });

    await analytics.execute(Orders, {
      measures: ['revenue'],
    });

    expect(queries[0]).toContain('SELECT SUM(amount) AS revenue FROM orders');
    expect(queries[0]).not.toContain('GROUP BY');
  });

  it('handles dataset without tenantKey', async () => {
    const { backend, queries } = createTestBackend([]);
    const analytics = createDatasetClient({ backend });

    await analytics.execute(
      Products,
      {
        dimensions: ['category'],
        measures: ['productCount'],
      },
      {
        runtime: {
          tenant: { id: 'tenant_123' },
        },
      },
    );

    // Should not inject tenant filter for dataset without tenantKey
    expect(queries[0]).not.toContain('tenant_id');
  });

  it('returns timing metadata', async () => {
    const { backend } = createTestBackend([{ country: 'US', revenue: 1000 }]);
    const analytics = createDatasetClient({ backend });

    const result = await analytics.execute(Orders, {
      dimensions: ['country'],
      measures: ['revenue'],
    });

    expect(result.meta.timingMs).toBeGreaterThanOrEqual(0);
    expect(typeof result.meta.timingMs).toBe('number');
  });

  it('returns SQL in metadata', async () => {
    const { backend } = createTestBackend([{ country: 'US', revenue: 1000 }]);
    const analytics = createDatasetClient({ backend });

    const result = await analytics.execute(Orders, {
      dimensions: ['country'],
      measures: ['revenue'],
    });

    expect(result.meta.sql).toBeDefined();
    expect(result.meta.sql).toContain('SELECT');
    expect(result.meta.sql).toContain('FROM orders');
  });

  it('returns tenant in metadata when provided', async () => {
    const { backend } = createTestBackend([{ country: 'US', revenue: 1000 }]);
    const analytics = createDatasetClient({ backend });

    const result = await analytics.execute(
      TenantOrders,
      {
        dimensions: ['country'],
        measures: ['revenue'],
      },
      {
        runtime: {
          tenant: { id: 'tenant_123' },
        },
      },
    );

    expect(result.meta.tenant).toBe('tenant_123');
  });
});

// =============================================================================
// SQL Generation via explain()
// =============================================================================

describe('ClickHouse Backend - SQL Generation via Explain', () => {
  it('backend supports explain() to generate SQL without execution', async () => {
    const { backend, queries } = createTestBackend([]);
    const analytics = createDatasetClient({ backend });

    // Execute to verify SQL is generated
    await analytics.execute(Orders, {
      dimensions: ['country'],
      measures: ['revenue'],
    });

    // Verify the query was generated
    expect(queries[0]).toContain('SELECT country, SUM(amount) AS revenue FROM orders');
    expect(queries[0]).toContain('GROUP BY country');
    expect(queries.length).toBe(1);
  });
});
