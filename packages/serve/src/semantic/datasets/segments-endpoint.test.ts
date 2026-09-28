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
  it('uses a query timezone override for dataset and metric time-key filters', async () => {
    const factory = capturingFactory();
    const Events = dataset('orders', {
      source: 'events', timeKey: 'time',
      dimensions: { time: dimension.timestamp({ column: 'event_at' }) },
      measures: { revenue: measure.sum('amount') },
    });
    const api = createAPI({
      datasets: { orders: Events }, metrics: { revenue: Events.metric('revenue', { measure: 'revenue' }) },
      queryBuilder: factory,
    });
    const body = { by: 'day', timezone: 'America/New_York', filters: [{ field: 'time', operator: 'gte', value: '2026-01-02' }] };
    const datasetResponse = await api.handler(request({ ...body, measures: ['revenue'] }));
    expect(factory.wheres).toContainEqual(["toDateTime64(event_at, 9, 'America/New_York')", 'gte', '2026-01-02']);
    factory.wheres.length = 0;
    const metricResponse = await api.handler({ ...request(body), path: '/api/analytics/metrics/revenue' });
    expect(datasetResponse.status).toBe(200);
    expect(metricResponse.status).toBe(200);
    expect(factory.wheres).toContainEqual(["toDateTime64(event_at, 9, 'America/New_York')", 'gte', '2026-01-02']);
    const invalid = await api.handler(request({ ...body, measures: ['revenue'], timezone: 'Bad/Zone' }));
    expect(invalid.status).toBe(400);
  });

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
