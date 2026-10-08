import { describe, expect, it } from 'vitest';
import { createAPI } from '../../server/create-api.js';
import { dataset, dimension, measure, type QueryBuilderFactoryLike, type QueryBuilderLike } from '@hypequery/datasets';
import type { ServeRequest } from '../../types.js';
import { buildDatasetQueryDescription } from './utils/dataset-query-metadata.js';

const Orders = dataset('orders', {
  source: 'orders',
  dimensions: {
    customerId: dimension.string({ column: 'customer_id' }),
    amount: dimension.number(),
  },
  measures: {
    revenue: measure.sum('amount'),
    orders: measure.count('customerId'),
  },
});

function capturingFactory(): QueryBuilderFactoryLike & { raw: { sql: string; params: unknown[] }[] } {
  const raw: { sql: string; params: unknown[] }[] = [];
  function createBuilder(): QueryBuilderLike {
    const builder = {
      select: () => builder,
      sum: () => builder,
      count: () => builder,
      where: () => builder,
      groupBy: () => builder,
      orderBy: () => builder,
      limit: () => builder,
      offset: () => builder,
      toSQLWithParams: () => ({ sql: 'SELECT customer_id AS customerId, SUM(amount) AS revenue FROM orders GROUP BY customerId', parameters: [] }),
      execute: async () => [],
    } as unknown as QueryBuilderLike;
    return builder;
  }
  return {
    table: createBuilder,
    rawQuery: async (sql: string, params: unknown[] = []) => {
      raw.push({ sql, params });
      return [];
    },
    raw,
  } as unknown as QueryBuilderFactoryLike & { raw: { sql: string; params: unknown[] }[] };
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

describe('dataset endpoint having', () => {
  it('forwards having conditions to the dataset query as bound parameters', async () => {
    const factory = capturingFactory();
    const api = createAPI({ datasets: { orders: Orders }, queryBuilder: factory });
    const response = await api.handler(request({
      dimensions: ['customerId'],
      measures: ['revenue'],
      having: [{ measure: 'revenue', operator: 'gt', value: 1000 }],
    }));

    expect(response.status).toBe(200);
    expect(factory.raw).toHaveLength(1);
    expect(factory.raw[0].sql).toContain('FROM base WHERE `revenue` > ?');
    expect(factory.raw[0].params).toEqual([1000]);
  });

  it.each([
    ['an unknown measure', { measure: 'profit', operator: 'gt', value: 1 }],
    ['a dimension', { measure: 'customerId', operator: 'gt', value: 1 }],
    ['an unsupported operator', { measure: 'revenue', operator: 'inSubquery', value: 'SELECT 1' }],
    ['a string value', { measure: 'revenue', operator: 'gt', value: '1 OR 1=1' }],
  ])('rejects %s at the input schema', async (_label, condition) => {
    const factory = capturingFactory();
    const api = createAPI({ datasets: { orders: Orders }, queryBuilder: factory });
    const response = await api.handler(request({ measures: ['revenue'], having: [condition] }));
    expect(response.status).toBe(400);
    expect(factory.raw).toEqual([]);
  });

  it('rejects a condition on a measure the query does not select', async () => {
    const factory = capturingFactory();
    const api = createAPI({ datasets: { orders: Orders }, queryBuilder: factory });
    const response = await api.handler(request({
      measures: ['orders'],
      having: [{ measure: 'revenue', operator: 'gt', value: 1 }],
    }));
    expect(response.status).toBe(400);
    expect(JSON.stringify(response.body)).toContain('must be one of the selected measures');
    expect(factory.raw).toEqual([]);
  });

  it('documents having on the dataset endpoint', () => {
    expect(buildDatasetQueryDescription(Orders, 100)).toContain('**Having:**');
  });
});
