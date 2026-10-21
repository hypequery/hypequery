import { describe, expect, it } from 'vitest';
import { belongsTo, buildProtocolDeploymentContract, createDatasetClient, dataset, dimension, measure } from './index.js';
import { createQueryBuilder } from '../../clickhouse/src/index.js';

const Customers = dataset('customers', {
  source: 'customers',
  dimensions: { id: dimension.string(), email: dimension.string({ groupable: false }), country: dimension.string() },
  measures: { total: measure.count('id') },
});

const Orders = dataset('orders', {
  source: 'orders',
  dimensions: {
    id: dimension.string(),
    customerId: dimension.string({ column: 'customer_id' }),
    // Backs a filter or measure, but must not become a grouping key.
    ip: dimension.string({ groupable: false }),
  },
  measures: { revenue: measure.sum('amount') },
  relationships: { customer: belongsTo(() => Customers, { from: 'customer_id', to: 'id' }) },
});

const client = createDatasetClient({
  queryBuilder: createQueryBuilder({ host: 'http://localhost:1', database: 'x' } as never),
});

describe('groupable: false', () => {
  it('is refused as a dimension, locally and through a relationship, as in Python', () => {
    expect(client.validate(Orders, { dimensions: ['ip'], measures: ['revenue'] }).errors)
      .toContain('Dimension "ip" is not groupable.');
    expect(client.validate(Orders, { dimensions: ['customer.email'], measures: ['revenue'] }).errors)
      .toContain('Dimension "customer.email" is not groupable.');
  });

  it('stays filterable', () => {
    expect(client.validate(Orders, {
      dimensions: ['customer.country'],
      measures: ['revenue'],
      filters: [{ field: 'ip', operator: 'eq', value: '10.0.0.1' }],
    }).valid).toBe(true);
  });
});

describe('deployment contract identity', () => {
  it('does not depend on the order datasets are passed in', () => {
    const forward = buildProtocolDeploymentContract([Customers, Orders]);
    const backward = buildProtocolDeploymentContract([Orders, Customers]);
    expect(JSON.stringify(backward)).toBe(JSON.stringify(forward));
    expect(forward.datasets.map(contract => String(contract.name))).toEqual(['customers', 'orders']);
  });
});
