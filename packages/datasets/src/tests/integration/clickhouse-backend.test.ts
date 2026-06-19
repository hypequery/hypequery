import { describe, expect, it } from 'vitest';

import { createBackend } from '../../../../clickhouse/src/datasets.js';
import { createDatasetClient } from '../../executor.js';
import { dataset } from '../../dataset.js';
import { dimension } from '../../field.js';
import { divide, nullIfZero, round } from '../../formulas.js';
import { measure } from '../../measure.js';
import { eq, gt } from '../../query-helpers.js';
import {
  TEST_CONNECTION_CONFIG,
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

const TenantOrders = dataset('tenantOrders', {
  source: 'orders',
  tenantKey: 'status',
  dimensions: Orders.dimensions,
  measures: {
    revenue: measure.sum('total'),
    orderCount: measure.count('id'),
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

    expect(result.data).toEqual([
      { status: 'pending', revenue: 62.25, orderCount: '1', uniqueUsers: '1' },
      { status: 'completed', revenue: 51, orderCount: '2', uniqueUsers: '2' },
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

    expect(result.data).toEqual([
      { revenue: 66, orderCount: '3' },
    ]);
    expect(result.meta).toMatchObject({
      tenant: 'completed',
    });
    expect(result.meta?.sql).toContain('WHERE status = ?');
  });
});
