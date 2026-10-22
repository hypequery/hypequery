import { describe, expect, it } from 'vitest';
import { belongsTo, buildProtocolDeploymentContract, createDatasetClient, dataset, dimension, measure } from './index.js';
import { createQueryBuilder } from '../../clickhouse/src/index.js';
import { byName } from './utils/by-name.js';

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

describe('protocol name order', () => {
  // Python's portable_name_key gives this order; it must not follow the host locale.
  const names = ['z', 'aa', '_x', 'a1', 'Ab', 'ab', 'a_b', 'a', 'B', 'b2'];
  const expected = ['_x', 'a', 'a_b', 'a1', 'aa', 'ab', 'Ab', 'B', 'b2', 'z'];

  it('is a fixed collation that matches Python', () => {
    expect(names.map(name => ({ name })).sort(byName).map(item => item.name)).toEqual(expected);
  });

  it('agrees with root-collation localeCompare for protocol names', () => {
    expect([...names].sort((left, right) => left.localeCompare(right, 'und'))).toEqual(expected);
  });

  it('orders deployment datasets the same way', () => {
    const named = (name: string) => dataset(name, {
      source: name,
      dimensions: { id: dimension.string() },
      measures: { total: measure.count('id') },
    });
    const contract = buildProtocolDeploymentContract([named('z'), named('aa')]);
    expect(contract.datasets.map(item => String(item.name))).toEqual(['aa', 'z']);
  });
});

describe('groupable: false on metric queries', () => {
  const revenue = Orders.metric('orderRevenue', { measure: 'revenue' });

  it('refuses a non-groupable dimension, locally and through a relationship', () => {
    expect(client.validate(revenue, { dimensions: ['ip'] }).errors.join(' ')).toMatch(/"ip" is not groupable/);
    expect(client.validate(revenue, { dimensions: ['customer.email'] }).errors.join(' '))
      .toMatch(/"customer.email" is not groupable/);
  });

  it('still filters on it', () => {
    expect(client.validate(revenue, { filters: [{ field: 'ip', operator: 'eq', value: '10.0.0.1' }] }).valid).toBe(true);
  });
});
