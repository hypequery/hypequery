import { describe, expect, it } from 'vitest';
import { createQueryBuilder } from '../../../clickhouse/src/index.js';
import { dataset } from '../dataset.js';
import { dimension } from '../field.js';
import { measure } from '../measure.js';
import { belongsTo } from '../relationships.js';
import type { QueryBuilderFactoryLike } from '../query-builder-protocol.js';
import { assertDatasetsSupported, datasetQueryBuilderErrors } from './dataset-engine-support.js';

const Customers = dataset('customers', {
  source: 'analytics.customers', final: true,
  dimensions: { id: dimension.number() }, measures: { n: measure.count('id') },
});
const Orders = dataset('orders', {
  source: 'analytics.orders',
  dimensions: { customerId: dimension.number({ column: 'customer_id' }), amount: dimension.number() },
  measures: {
    revenue: measure.sum('amount'),
    p95: measure.percentile('amount', 0.95),
    users: measure.merge('uniq', 'users'),
  },
  relationships: { customer: belongsTo(() => Customers, { from: 'customer_id', to: 'id' }) },
});

describe('datasetQueryBuilderErrors', () => {
  it('accepts everything on ClickHouse', () => {
    const clickhouse = createQueryBuilder({ host: 'http://localhost:8123' });
    expect(datasetQueryBuilderErrors(Orders, clickhouse)).toEqual([]);
    expect(datasetQueryBuilderErrors(Customers, clickhouse)).toEqual([]);
  });

  it('reports what a minimal builder lacks, and stays quiet when it cannot probe one', () => {
    const minimal = { table: () => ({ select() {}, sum() {} }), rawQuery: async () => [] } as unknown as QueryBuilderFactoryLike;
    expect(datasetQueryBuilderErrors(Orders, minimal)).toEqual([
      'Dataset "orders": measure "p95" uses percentile, which the clickhouse query builder does not support.',
      'Dataset "orders": measure "users" uses merge, which the clickhouse query builder does not support.',
      'Dataset "orders": relationship "customer" needs a single-match join (leftAnyJoin), which this query builder does not implement.',
    ]);
    const unprobeable = { table: () => { throw new Error('lazy'); }, rawQuery: async () => [] } as unknown as QueryBuilderFactoryLike;
    expect(() => assertDatasetsSupported({ Orders, Customers }, unprobeable)).not.toThrow();
  });
});
