import { beforeAll, describe, expect, it } from 'vitest';

import { createBackend } from '../../../../clickhouse/src/datasets.js';
import { createDatasetClient } from '../../executor.js';
import { dataset } from '../../dataset.js';
import { dimension } from '../../field.js';
import { divide, nullIfZero, round } from '../../formulas.js';
import { measure } from '../../measure.js';
import { belongsTo } from '../../relationships.js';
import { eq, gt } from '../../query-helpers.js';
import { createInMemoryBackend } from '../../in-memory-backend.js';
import {
  TEST_CONNECTION_CONFIG,
  insertRows,
  runSql,
} from '../../../../../testing/clickhouse/harness.mjs';

const Orders = dataset('orders', {
  source: 'orders',
  timeKey: 'created_at',
  dimensions: {
    id: dimension.number(),
    userId: dimension.number({ column: 'user_id' }),
    productId: dimension.number({ column: 'product_id' }),
    quantity: dimension.number(),
    total: dimension.number(),
    status: dimension.string(),
    createdAt: dimension.timestamp({ column: 'created_at' }),
  },
  measures: {
    revenue: measure.sum('total'),
    orderCount: measure.count('id'),
    averageOrderValue: measure.avg('total'),
    uniqueUsers: measure.countDistinct('userId'),
    completedRevenue: measure.sum('total', {
      filters: [eq('status', 'completed')],
    }),
    highValueRevenue: measure.sum('total', {
      filters: [gt('total', 20)],
    }),
  },
});

const AnalyticalOrders = dataset('analyticalOrders', {
  source: 'orders',
  timeKey: 'created_at',
  dimensions: Orders.dimensions,
  measures: {
    latestTotal: measure.argMax('total', 'createdAt'),
    firstTotal: measure.argMin('total', 'createdAt'),
    medianTotal: measure.median('total'),
    p95Total: measure.percentile('total', 0.95),
    totalStddev: measure.stddev('total'),
    totalVariance: measure.variance('total'),
  },
});

const TenantOrders = dataset('tenantOrders', {
  source: 'orders',
  tenantKey: 'status',
  dimensions: Orders.dimensions,
  measures: {
    revenue: measure.sum('total'),
    orderCount: measure.count('id'),
  },
});

const Users = dataset('users', {
  source: 'users',
  dimensions: {
    id: dimension.number(),
    userName: dimension.string({ column: 'user_name' }),
    email: dimension.string(),
    status: dimension.string(),
  },
});

const OrdersWithUser = dataset('ordersWithUser', {
  source: 'orders',
  timeKey: 'created_at',
  dimensions: Orders.dimensions,
  measures: {
    revenue: measure.sum('total'),
    orderCount: measure.count('id'),
  },
  relationships: {
    user: belongsTo(() => Users, { from: 'user_id', to: 'id' }),
  },
});

// Target dataset with a tenantKey, to exercise defense-in-depth join scoping.
const TenantUsers = dataset('tenantUsers', {
  source: 'users',
  tenantKey: 'status',
  dimensions: {
    id: dimension.number(),
    userName: dimension.string({ column: 'user_name' }),
    status: dimension.string(),
  },
});

const OrdersWithTenantUser = dataset('ordersWithTenantUser', {
  source: 'orders',
  dimensions: Orders.dimensions,
  measures: {
    revenue: measure.sum('total'),
  },
  relationships: {
    user: belongsTo(() => TenantUsers, { from: 'user_id', to: 'id' }),
  },
});

function createClient() {
  return createDatasetClient({
    backend: createBackend({
      host: TEST_CONNECTION_CONFIG.host,
      username: TEST_CONNECTION_CONFIG.user,
      password: TEST_CONNECTION_CONFIG.password,
      database: TEST_CONNECTION_CONFIG.database,
    }),
  });
}

function normalizeCount(value: unknown): number {
  return Number(value);
}

describe('datasets ClickHouse integration', () => {
  it('executes a dataset query with dimensions, filters, measures, ordering, and pagination', async () => {
    const analytics = createClient();

    const result = await analytics.execute(Orders, {
      dimensions: ['status'],
      measures: ['revenue', 'orderCount', 'uniqueUsers'],
      filters: [gt('total', 15)],
      orderBy: [{ field: 'revenue', direction: 'desc' }],
      limit: 2,
    });

    expect(result.data.map((row) => ({
      ...row,
      orderCount: normalizeCount(row.orderCount),
      uniqueUsers: normalizeCount(row.uniqueUsers),
    }))).toEqual([
      { status: 'pending', revenue: 62.25, orderCount: 1, uniqueUsers: 1 },
      { status: 'completed', revenue: 51, orderCount: 2, uniqueUsers: 2 },
    ]);
    expect(result.meta?.timingMs).toEqual(expect.any(Number));
    expect(result.meta?.sql).toContain('FROM orders');
    expect(result.meta?.sql).toContain('GROUP BY status');
  });

  it('executes filtered measures and time grains against real ClickHouse rows', async () => {
    const analytics = createClient();

    const result = await analytics.execute(Orders, {
      by: 'day',
      measures: ['revenue', 'completedRevenue', 'highValueRevenue'],
      orderBy: [{ field: 'period', direction: 'asc' }],
    });

    expect(result.data).toEqual([
      { period: '2023-01-10 00:00:00', revenue: 21, completedRevenue: 21, highValueRevenue: 21 },
      { period: '2023-01-11 00:00:00', revenue: 15, completedRevenue: 15, highValueRevenue: 0 },
      { period: '2023-01-12 00:00:00', revenue: 62.25, completedRevenue: 0, highValueRevenue: 62.25 },
      { period: '2023-01-13 00:00:00', revenue: 30, completedRevenue: 30, highValueRevenue: 30 },
      { period: '2023-01-14 00:00:00', revenue: 16.5, completedRevenue: 0, highValueRevenue: 0 },
    ]);
    expect(result.meta?.sql).toContain('toStartOfDay(created_at) AS period');
  });

  it('executes base and derived metric queries through the public client', async () => {
    const analytics = createClient();
    const revenue = Orders.metric('revenue', { measure: 'revenue' });
    const orderCount = Orders.metric('orderCount', { measure: 'orderCount' });
    const averageOrderValue = Orders.metric('averageOrderValueMetric', {
      uses: { revenue, orderCount },
      formula: ({ revenue: revenueInput, orderCount: orderCountInput }) =>
        round(divide(revenueInput, nullIfZero(orderCountInput)), 2),
    });

    const baseResult = await analytics.execute(revenue, {
      dimensions: ['status'],
      orderBy: [{ field: 'revenue', direction: 'desc' }],
      limit: 1,
    });
    const derivedResult = await analytics.execute(averageOrderValue, {
      dimensions: ['status'],
      orderBy: [{ field: 'averageOrderValueMetric', direction: 'desc' }],
      limit: 1,
    });

    expect(baseResult.data).toEqual([
      { status: 'completed', revenue: 66 },
    ]);
    expect(derivedResult.data).toEqual([
      { status: 'pending', averageOrderValueMetric: 62.25 },
    ]);
    expect(derivedResult.meta?.sql).toContain('WITH base AS');
  });

  it('applies runtime tenant scoping in backend plans', async () => {
    const analytics = createClient();

    const result = await analytics.execute(
      TenantOrders,
      {
        measures: ['revenue', 'orderCount'],
      },
      {
        runtime: {
          tenant: { id: 'completed' },
        },
      },
    );

    expect(result.data.map((row) => ({
      ...row,
      orderCount: normalizeCount(row.orderCount),
    }))).toEqual([
      { revenue: 66, orderCount: 3 },
    ]);
    expect(result.meta).toMatchObject({
      tenant: 'completed',
    });
    expect(result.meta?.sql).toContain('WHERE status = ?');
  });

  it('groups a base measure by a to-one joined dimension', async () => {
    const analytics = createClient();

    const result = await analytics.execute(OrdersWithUser, {
      dimensions: ['user.userName'],
      measures: ['revenue'],
      orderBy: [{ field: 'revenue', direction: 'desc' }],
    });

    // Every order maps to a user, so no LEFT JOIN misses here.
    expect(result.data).toEqual([
      { 'user.userName': 'jane_smith', revenue: 92.25 },
      { 'user.userName': 'john_doe', revenue: 36 },
      { 'user.userName': 'bob_jones', revenue: 16.5 },
    ]);
    expect(result.meta?.sql).toContain('LEFT JOIN users AS user ON orders.user_id = user.id');
    expect(result.meta?.sql).toContain('user.user_name AS `user.userName`');
    expect(result.meta?.sql).toContain('SUM(orders.total) AS revenue');
  });

  it('filters a base measure by a joined dimension', async () => {
    const analytics = createClient();

    const result = await analytics.execute(OrdersWithUser, {
      dimensions: ['status'],
      measures: ['revenue'],
      filters: [eq('user.status', 'active')],
      orderBy: [{ field: 'revenue', direction: 'desc' }],
    });

    // Active users (john_doe, jane_smith) own orders 1-4; bob_jones' order is excluded.
    expect(result.data).toEqual([
      { status: 'completed', revenue: 66 },
      { status: 'pending', revenue: 62.25 },
    ]);
    expect(result.meta?.sql).toContain('user.status = ?');
  });

  it('scopes the joined target by tenant (defense in depth)', async () => {
    const analytics = createClient();

    const result = await analytics.execute(
      OrdersWithTenantUser,
      {
        dimensions: ['user.userName'],
        measures: ['revenue'],
        orderBy: [{ field: 'revenue', direction: 'desc' }],
      },
      { runtime: { tenant: { id: 'active' } } },
    );

    // The inactive user must not leak, but its base order must survive the LEFT JOIN.
    const revenueByUser = new Map(
      result.data.map((row) => [row['user.userName'], row.revenue]),
    );
    expect(revenueByUser.get('jane_smith')).toBe(92.25);
    expect(revenueByUser.get('john_doe')).toBe(36);
    expect(revenueByUser.has('bob_jones')).toBe(false);
    expect(result.data.reduce((total, row) => total + Number(row.revenue), 0)).toBe(144.75);
    expect(result.meta?.sql).toContain(
      'LEFT JOIN users AS user ON orders.user_id = user.id AND user.status = ?',
    );
    expect(result.meta?.sql).not.toContain('WHERE user.status = ?');
  });
  it('executes argMax/argMin measures against real ClickHouse rows', async () => {
    const analytics = createClient();

    const result = await analytics.execute(AnalyticalOrders, {
      measures: ['latestTotal', 'firstTotal'],
    });

    // Latest order (2023-01-14) has total 16.5; earliest (2023-01-10) has 21.
    expect(result.data).toEqual([{ latestTotal: 16.5, firstTotal: 21 }]);
    expect(result.meta?.sql).toContain('argMax(total, created_at) AS latestTotal');
    expect(result.meta?.sql).toContain('argMin(total, created_at) AS firstTotal');
  });

  it('executes percentile, stddev, and variance measures against real ClickHouse rows', async () => {
    const analytics = createClient();

    const result = await analytics.execute(AnalyticalOrders, {
      measures: ['medianTotal', 'p95Total', 'totalStddev', 'totalVariance'],
    });

    // totals [15, 16.5, 21, 30, 62.25]
    const row = result.data[0] as Record<string, number>;
    expect(row.medianTotal).toBe(21);
    expect(row.p95Total).toBeCloseTo(55.8, 2);
    expect(row.totalVariance).toBeCloseTo(380.7, 2);
    expect(row.totalStddev).toBeCloseTo(Math.sqrt(380.7), 2);
    expect(result.meta?.sql).toContain('quantile(0.5)(total) AS medianTotal');
    expect(result.meta?.sql).toContain('stddevSamp(total) AS totalStddev');
  });

  it('groups analytical measures by dimension against real ClickHouse rows', async () => {
    const analytics = createClient();

    const result = await analytics.execute(AnalyticalOrders, {
      dimensions: ['status'],
      measures: ['latestTotal'],
      orderBy: [{ field: 'status', direction: 'asc' }],
    });

    expect(result.data).toEqual([
      { status: 'cancelled', latestTotal: 16.5 },
      { status: 'completed', latestTotal: 30 },
      { status: 'pending', latestTotal: 62.25 },
    ]);
  });

  it('returns null variance/stddev for single-row groups, matching the in-memory backend', async () => {
    const analytics = createClient();

    const result = await analytics.execute(AnalyticalOrders, {
      dimensions: ['status'],
      measures: ['totalVariance', 'totalStddev'],
      orderBy: [{ field: 'status', direction: 'asc' }],
    });

    const [cancelled, completed, pending] = result.data as Array<Record<string, unknown>>;
    // Single-row groups: varSamp/stddevSamp divide by n - 1, yielding nan,
    // which ClickHouse's JSON output serializes as null.
    expect(cancelled).toEqual({ status: 'cancelled', totalVariance: null, totalStddev: null });
    expect(pending).toEqual({ status: 'pending', totalVariance: null, totalStddev: null });
    // completed totals [21, 15, 30] → sample variance 57
    expect(completed.status).toBe('completed');
    expect(Number(completed.totalVariance)).toBeCloseTo(57, 6);
    expect(Number(completed.totalStddev)).toBeCloseTo(Math.sqrt(57), 6);
  });

  describe('argMax NULL-value parity with the in-memory backend', () => {
    const nullableRows = [
      { id: 1, amount: null, created_at: '2024-01-05' },
      { id: 2, amount: 10, created_at: '2024-01-01' },
    ];

    const NullableOrders = dataset('nullableOrders', {
      source: 'nullable_orders',
      dimensions: {
        id: dimension.number(),
        amount: dimension.number(),
        createdAt: dimension.timestamp({ column: 'created_at' }),
      },
      measures: {
        latestAmount: measure.argMax('amount', 'createdAt'),
      },
    });

    beforeAll(async () => {
      await runSql(
        `DROP TABLE IF EXISTS ${TEST_CONNECTION_CONFIG.database}.nullable_orders`,
        { includeDatabase: false },
      );
      await runSql(
        `CREATE TABLE ${TEST_CONNECTION_CONFIG.database}.nullable_orders (
          id UInt32,
          amount Nullable(Float64),
          created_at Date
        ) ENGINE = MergeTree() ORDER BY id`,
        { includeDatabase: false },
      );
      await insertRows('nullable_orders', nullableRows);
    });

    it('skips rows whose value column is NULL on both backends', async () => {
      // The row with the greatest created_at has a NULL amount. ClickHouse
      // argMax skips rows where either the value or the arg is NULL, so it
      // returns the next-best row's amount rather than NULL.
      const analytics = createClient();
      const clickhouse = await analytics.execute(NullableOrders, {
        measures: ['latestAmount'],
      });
      expect(clickhouse.data).toEqual([{ latestAmount: 10 }]);

      const inMemory = await createDatasetClient({
        backend: createInMemoryBackend({ nullable_orders: nullableRows }),
      }).execute(NullableOrders, { measures: ['latestAmount'] });
      expect(Number(inMemory.data[0].latestAmount)).toBe(10);
    });
  });
});
