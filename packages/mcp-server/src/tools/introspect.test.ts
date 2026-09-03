import { belongsTo, dataset, dimension, measure } from '@hypequery/datasets';
import { describe, expect, it } from 'vitest';
import { getDatasetSchemaTool, getTrustedDatasetSchema } from './introspect.js';

describe('dataset introspection', () => {
  it('validates the requested dataset', async () => {
    await expect(getDatasetSchemaTool({}, {})).rejects.toMatchObject({
      code: 'MCP_INVALID_ARGUMENTS',
    });
    await expect(getDatasetSchemaTool({}, { dataset: 42 })).rejects.toMatchObject({
      code: 'MCP_INVALID_ARGUMENTS',
    });
    await expect(getDatasetSchemaTool({}, { dataset: 'missing' })).rejects.toMatchObject({
      code: 'MCP_NOT_FOUND',
    });
  });

  it('returns the agent-safe logical projection for canonical datasets', async () => {
    const Customers = dataset('customers', {
      source: 'private.customers',
      dimensions: {
        id: dimension.number({ column: 'customer_id' }),
        country: dimension.string({ column: 'country_code' }),
      },
    });
    const Orders = dataset('orders', {
      source: 'private.orders',
      tenantKey: 'tenant_id',
      timeKey: 'createdAt',
      dimensions: {
        createdAt: dimension.timestamp({ column: 'created_at' }),
        customerId: dimension.number({ column: 'customer_id' }),
        amount: dimension.number({ filterable: false, groupable: false }),
      },
      measures: {
        revenue: measure.sum('amount', { label: 'Revenue' }),
      },
      relationships: {
        customer: belongsTo(() => Customers, { from: 'customerId', to: 'id' }),
      },
    });
    const totalRevenue = Orders.metric('totalRevenue', { measure: 'revenue' });

    const response = await getDatasetSchemaTool({
      orders: { ...Orders, metrics: { totalRevenue } },
    }, { dataset: 'orders' });
    const schema = JSON.parse(response.content[0].text);

    expect(response.structuredContent).toEqual(schema);
    expect(schema).toMatchObject({
      name: 'orders',
      timeDimension: 'createdAt',
      dimensions: [
        { name: 'createdAt', type: 'timestamp' },
        { name: 'customerId', type: 'number' },
      ],
      measures: [{ name: 'revenue', label: 'Revenue' }],
      metrics: [{ name: 'totalRevenue' }],
      relationships: [{
        name: 'customer',
        target: 'customers',
        fields: ['customer.country', 'customer.id'],
      }],
    });
    const serialized = JSON.stringify(schema);
    for (const forbidden of [
      'private.orders', 'tenant_id', 'created_at', 'customer_id', 'private.customers',
    ]) {
      expect(serialized).not.toContain(forbidden);
    }
    expect(serialized).not.toContain('"amount"');
    expect(serialized).not.toContain('"aggregation"');
  });

  it('safely adapts the legacy registry shape', async () => {
    const response = await getDatasetSchemaTool({
      orders: {
        description: 'Orders',
        source: 'private.orders',
        tenantKey: 'tenant_id',
        dimensions: {
          region: { type: 'string', column: 'region_code', label: 'Region' },
          hidden: { type: 'number', column: 'secret', filterable: false, groupable: false },
        },
        measures: { revenue: { field: 'amount', aggregation: 'sum' } },
        metrics: { totalRevenue: { dimensions: ['region'], grains: [] } },
      },
    }, { dataset: 'orders' });
    const schema = JSON.parse(response.content[0].text);

    expect(schema).toMatchObject({
      name: 'orders',
      description: 'Orders',
      dimensions: [{ name: 'region', type: 'string', label: 'Region' }],
      measures: [{ name: 'revenue' }],
      metrics: [{ name: 'totalRevenue', dimensions: ['region'] }],
    });
    expect(JSON.stringify(schema)).not.toMatch(/private\.orders|tenant_id|region_code|secret|amount/);
  });

  it('requires separate authorization for trusted physical diagnostics', async () => {
    const Orders = dataset('orders', {
      source: 'analytics.orders',
      tenantKey: 'tenant_id',
      dimensions: { id: dimension.number({ column: 'order_id' }) },
    });

    await expect(getTrustedDatasetSchema(
      { orders: Orders },
      { dataset: 'orders' },
      {} as { authorized: true },
    )).rejects.toThrow('requires explicit authorization');

    await expect(getTrustedDatasetSchema(
      { orders: Orders },
      { dataset: 'orders' },
      { authorized: true },
    )).resolves.toMatchObject({
      source: 'analytics.orders',
      tenantKey: 'tenant_id',
      dimensions: { id: { column: 'order_id' } },
    });
  });
});
