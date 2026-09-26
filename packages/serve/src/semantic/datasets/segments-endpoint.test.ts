import { describe, expect, it } from 'vitest';
import { createAPI } from '../../server/create-api.js';
import { dataset, dimension, measure, type QueryBuilderFactoryLike, type QueryBuilderLike } from '@hypequery/datasets';
import type { ServeRequest } from '../../types.js';

const Orders = dataset('orders', {
  source: 'orders',
  dimensions: {
    country: dimension.string(),
    status: dimension.string({ filterable: false }),
  },
  measures: { revenue: measure.sum('amount') },
  segments: { paid: { filters: [{ field: 'status', operator: 'eq', value: 'paid' }] } },
});

function capturingFactory(): QueryBuilderFactoryLike & { wheres: unknown[][] } {
  const wheres: unknown[][] = [];
  function createBuilder(): QueryBuilderLike {
    const builder = {
      select: () => builder,
      sum: () => builder,
      where: (...args: unknown[]) => { wheres.push(args); return builder; },
      groupBy: () => builder,
      orderBy: () => builder,
      limit: () => builder,
      offset: () => builder,
      toSQLWithParams: () => ({ sql: 'SELECT 1', parameters: [] }),
      execute: async () => [],
    } as unknown as QueryBuilderLike;
    return builder;
  }
  return { table: createBuilder, rawQuery: async () => [], wheres };
}

function request(body: unknown): ServeRequest {
  return {
    method: 'POST',
    path: '/api/analytics/datasets/orders/query',
    query: {},
    headers: {},
    body,
  } as unknown as ServeRequest;
}

describe('dataset endpoint segments', () => {
  it('forwards selected segments to the dataset query', async () => {
    const factory = capturingFactory();
    const api = createAPI({ datasets: { orders: Orders }, queryBuilder: factory });
    const response = await api.handler(request({ measures: ['revenue'], segments: ['paid'] }));
    expect(response.status).toBe(200);
    expect(factory.wheres).toContainEqual(['status', 'eq', 'paid']);
  });

  it('rejects an unknown segment at the input schema', async () => {
    const api = createAPI({ datasets: { orders: Orders }, queryBuilder: capturingFactory() });
    const response = await api.handler(request({ measures: ['revenue'], segments: ['refunded'] }));
    expect(response.status).toBe(400);
  });
});
