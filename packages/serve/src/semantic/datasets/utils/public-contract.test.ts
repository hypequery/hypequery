import { describe, expect, it } from 'vitest';
import { belongsTo, dataset, dimension, divide, measure, serializeSemanticContract } from '@hypequery/datasets';
import { publicSemanticContract } from './public-contract.js';

const Customers = dataset('customers', {
  source: 'customers',
  dimensions: { name: dimension.string() },
});
const Orders = dataset('orders', {
  source: 'orders',
  dimensions: { status: dimension.string() },
  relationships: {
    customer: belongsTo(() => Customers, {
      keys: [{ from: 'customer_id', to: 'id' }, { from: 'region_code', to: 'region' }],
    }),
  },
});

describe('publicSemanticContract', () => {
  it('publishes composite relationships without their physical key columns', () => {
    const contract = serializeSemanticContract({ orders: Orders, customers: Customers });
    expect(contract.datasets.orders.relationships.customer.keys).toHaveLength(2);

    const published = publicSemanticContract(contract);
    expect(published.datasets.orders).toMatchObject({
      relationships: {
        customer: { kind: 'belongsTo', target: 'customers', queryable: true, fields: ['customer.name'] },
      },
    });
    const serialized = JSON.stringify(published);
    for (const column of ['customer_id', 'region_code', '"keys"', '"from"', '"to"']) {
      expect(serialized).not.toContain(column);
    }
  });

  it('publishes derived measures with their formula inputs', () => {
    const Sales = dataset('sales', {
      source: 'sales',
      dimensions: { status: dimension.string() },
      measures: {
        revenue: measure.sum('amount'),
        orderCount: measure.count(),
        averageOrderValue: measure.derived({
          uses: { revenue: 'revenue', orderCount: 'orderCount' },
          formula: ({ revenue, orderCount }) => divide(revenue, orderCount),
          label: 'Average order value',
        }),
      },
    });
    const published = publicSemanticContract(serializeSemanticContract({ sales: Sales }));
    expect(published.datasets.sales).toMatchObject({
      derivedMeasures: {
        averageOrderValue: {
          label: 'Average order value',
          uses: [{ alias: 'orderCount', measure: 'orderCount' }, { alias: 'revenue', measure: 'revenue' }],
          expression: expect.any(Object),
        },
      },
    });
  });
});
