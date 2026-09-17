import { beforeAll, describe, expect, it } from 'vitest';
import {
  buildProtocolDeploymentContract,
  createDatasetClient,
  dataset,
  dimension,
  divide,
  eq,
  measure,
  nullIfZero,
  rehydrateProtocolDeploymentContract,
} from '@hypequery/datasets';
import { initializeTestConnection, setupTestDatabase } from './setup.js';
import { SETUP_TIMEOUT, SKIP_INTEGRATION_TESTS } from './test-config.js';

const Orders = dataset('orders', {
  source: 'orders',
  timeKey: 'created_at',
  dimensions: {
    status: dimension.string(),
    id: dimension.number(),
    total: dimension.number(),
  },
  measures: {
    revenue: measure.sum('total'),
    completedRevenue: measure.sum('total', { filters: [eq('status', 'completed')] }),
    completedCount: measure.count('id', { filters: [eq('status', 'completed')] }),
    completedAverage: measure.derived({
      uses: { revenue: 'completedRevenue', orders: 'completedCount' },
      formula: ({ revenue, orders }) => divide(revenue, nullIfZero(orders)),
    }),
  },
});

(SKIP_INTEGRATION_TESTS ? describe.skip : describe)('deployment wire ClickHouse parity', () => {
  let builder: Awaited<ReturnType<typeof initializeTestConnection>>;

  beforeAll(async () => {
    builder = await initializeTestConnection();
    await setupTestDatabase();
  }, SETUP_TIMEOUT);

  it('matches authored, rehydrated, and ground-truth grouped results', async () => {
    const contract = buildProtocolDeploymentContract([Orders]);
    const rebuilt = rehydrateProtocolDeploymentContract(contract).orders;
    const client = createDatasetClient({ queryBuilder: builder });
    const query = {
      dimensions: ['status'],
      measures: ['revenue', 'completedAverage'],
      by: 'month',
      orderBy: [
        { field: 'completedAverage', direction: 'desc' },
        { field: 'status', direction: 'asc' },
      ],
      limit: 1,
      offset: 1,
    } as const;
    const authored = await client.execute(Orders, query);
    const portable = await client.execute(rebuilt, query);
    const raw = await builder.rawQuery<Record<string, unknown>>(`
      SELECT period, status, revenue,
        completedRevenue / nullIf(completedCount, 0) AS completedAverage
      FROM (
        SELECT toStartOfMonth(created_at) AS period, status,
          sum(total) AS revenue,
          sum(if(status = 'completed', total, 0)) AS completedRevenue,
          count(if(status = 'completed', id, NULL)) AS completedCount
        FROM orders GROUP BY period, status
      )
      ORDER BY completedAverage DESC, status ASC LIMIT 1 OFFSET 1
    `);
    const normalized = raw.map(row => ({
      period: row.period,
      status: row.status,
      revenue: row.revenue == null ? null : String(row.revenue),
      completedAverage: row.completedAverage == null ? null : String(row.completedAverage),
    }));

    expect(client.toSQL(rebuilt, query)).toBe(client.toSQL(Orders, query));
    expect(portable.data).toEqual(authored.data);
    expect(portable.data).toEqual(normalized);
    expect(portable.data[0]?.completedAverage).toBeNull();
    expect(portable.meta.pagination).toEqual({ limit: 1, offset: 1, hasMore: true });
  });
});
