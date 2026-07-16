import { describe, expect, it } from 'vitest';
import { belongsTo } from './relationships.js';
import { dataset } from './dataset.js';
import { dimension } from './field.js';
import { measure } from './measure.js';
import { eq } from './query-helpers.js';
import { divide, nullIfZero } from './formulas.js';
import { buildProtocolDatasetContract } from './protocol-adapter.js';

describe('Dataset protocol adapter', () => {
  it('lowers Dataset fields, trusted SQL, relationships, filters, and metrics', () => {
    const Customers = dataset('customers', {
      source: 'customers',
      dimensions: {
        id: dimension.string(),
        region: dimension.string(),
      },
    });
    const Orders = dataset('orders', {
      source: 'analytics.orders',
      tenantKey: 'tenant_id',
      timeKey: 'created_at',
      dimensions: {
        id: dimension.string(),
        amount: dimension.number(),
        netAmount: dimension.number({ sql: 'amount - discount' }),
      },
      measures: {
        revenue: measure.sum('amount', { filters: [eq('amount', 10)] }),
        orderCount: measure.count('id'),
        netRevenue: measure.sum('amount', { sql: 'amount - discount' }),
      },
      relationships: {
        customer: belongsTo(() => Customers, { from: 'customer_id', to: 'id' }),
      },
      limits: { maxResultSize: 250 },
    });
    const totalRevenue = Orders.metric('totalRevenue', { measure: 'revenue' });
    const orderCount = Orders.metric('orderCount', { measure: 'orderCount' });
    const averageOrderValue = Orders.metric('averageOrderValue', {
      uses: { totalRevenue, orderCount },
      formula: ({ totalRevenue: revenue, orderCount: count }) =>
        divide(revenue, nullIfZero(count)),
    });

    const contract = buildProtocolDatasetContract(Orders, {
      endpoint: {
        access: { kind: 'authenticated', roles: [], scopes: ['read:orders'] },
        tenant: { kind: 'required', mode: 'auto-inject', column: 'tenant_id' },
        maxLimit: 250,
        path: '/api/analytics/datasets/orders/query',
      },
      metrics: { averageOrderValue, totalRevenue },
      metricEndpoints: {
        averageOrderValue: {
          access: { kind: 'public' },
          tenant: { kind: 'required', mode: 'auto-inject', column: 'tenant_id' },
          maxLimit: 250,
          path: '/api/analytics/metrics/averageOrderValue',
        },
        totalRevenue: {
          access: { kind: 'public' },
          tenant: { kind: 'required', mode: 'auto-inject', column: 'tenant_id' },
          maxLimit: 250,
          path: '/api/analytics/metrics/totalRevenue',
        },
      },
    });

    expect(contract.tenant).toEqual({ kind: 'required', field: 'tenant_id' });
    expect(contract.dimensions.find(item => item.name === 'netAmount')?.source)
      .toMatchObject({
        kind: 'sql-expression',
        dialect: 'clickhouse',
        sql: 'amount - discount',
        dependencies: ['amount', 'id'],
      });
    expect(contract.measures.find(item => item.name === 'revenue')?.filters)
      .toHaveLength(1);
    expect(contract.metrics.find(item => item.name === 'totalRevenue')).toMatchObject({
      name: 'totalRevenue',
      kind: 'metric',
      expression: { kind: 'aggregate', aggregation: 'sum', field: 'amount' },
    });
    expect(contract.metrics.find(item => item.name === 'averageOrderValue')).toMatchObject({
      kind: 'derived-metric',
      expression: {
        kind: 'binary',
        operator: 'divide',
        left: { kind: 'aggregate', aggregation: 'sum', field: 'amount' },
        right: {
          kind: 'call',
          function: 'nullIfZero',
          args: [{ kind: 'aggregate', aggregation: 'count', field: 'id' }],
        },
      },
    });
    expect(contract.relationships[0]).toMatchObject({
      name: 'customer', target: 'customers', queryable: true,
    });
    expect(Object.isFrozen(contract)).toBe(true);
    expect(Object.isFrozen(contract.dimensions)).toBe(true);
  });
});
