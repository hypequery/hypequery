import { describe, expect, it } from 'vitest';
import { createAPI } from '../../server/create-api.js';
import { dataset, dimension, measure, type QueryBuilderFactoryLike, type QueryBuilderLike } from '@hypequery/datasets';
import type { ServeRequest } from '../../types.js';

const Orders = dataset('orders', {
  source: 'orders',
  timeKey: 'createdAt',
  timeKeys: ['shippedAt'],
  dimensions: {
    createdAt: dimension.timestamp({ column: 'created_at' }),
    shippedAt: dimension.timestamp({ column: 'shipped_at' }),
  },
  measures: { revenue: measure.sum('amount') },
});

function capturingFactory(): QueryBuilderFactoryLike & { selects: string[] } {
  const selects: string[] = [];
  function createBuilder(): QueryBuilderLike {
    const builder = {
      select: (parts: string | string[]) => { selects.push(...(Array.isArray(parts) ? parts : [parts])); return builder; },
      sum: () => builder,
      where: () => builder,
      groupBy: () => builder,
      orderBy: () => builder,
      limit: () => builder,
      offset: () => builder,
      toSQLWithParams: () => ({ sql: 'SELECT 1', parameters: [] }),
      execute: async () => [],
    } as unknown as QueryBuilderLike;
    return builder;
  }
  return { table: createBuilder, rawQuery: async () => [], selects };
}

function request(body: unknown, path = '/api/analytics/datasets/orders/query'): ServeRequest {
  return { method: 'POST', path, query: {}, headers: {}, body } as unknown as ServeRequest;
}

describe('dataset endpoint time keys', () => {
  it('buckets dataset and metric queries on the selected time axis', async () => {
    const factory = capturingFactory();
    const api = createAPI({
      datasets: { orders: Orders },
      metrics: { revenue: Orders.metric('revenue', { measure: 'revenue' }) },
      queryBuilder: factory,
    });

    const byDefault = await api.handler(request({ measures: ['revenue'], by: 'day' }));
    expect(byDefault.status).toBe(200);
    expect(factory.selects.join(' ')).toContain('created_at');
    factory.selects.length = 0;

    const shipped = await api.handler(request({ measures: ['revenue'], by: 'day', timeKey: 'shippedAt' }));
    expect(shipped.status).toBe(200);
    expect(factory.selects.join(' ')).toContain('shipped_at');
    expect(factory.selects.join(' ')).not.toContain('created_at');
    factory.selects.length = 0;

    const metric = await api.handler(request({ by: 'day', timeKey: 'shippedAt' }, '/api/analytics/metrics/revenue'));
    expect(metric.status).toBe(200);
    expect(factory.selects.join(' ')).toContain('shipped_at');
  });

  it('rejects an undeclared time axis at the input schema', async () => {
    const api = createAPI({ datasets: { orders: Orders }, queryBuilder: capturingFactory() });
    const response = await api.handler(request({ measures: ['revenue'], by: 'day', timeKey: 'deliveredAt' }));
    expect(response.status).toBe(400);
  });
});
