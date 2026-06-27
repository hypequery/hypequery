import { describe, expect, it } from 'vitest';
import { dataset } from './dataset.js';
import { dimension } from './field.js';
import { measure } from './measure.js';
import { belongsTo } from './relationships.js';
import { getDatasetCatalog, getDatasetCatalogs } from './catalog.js';

describe('dataset catalog', () => {
  const Customers = dataset('customers', {
    source: 'customers',
    dimensions: {
      id: dimension.string(),
      country: dimension.string({ label: 'Country' }),
    },
    measures: {
      customerCount: measure.count('id'),
    },
  });

  const Orders = dataset('orders', {
    source: 'orders',
    tenantKey: 'tenant_id',
    timeKey: 'created_at',
    dimensions: {
      id: dimension.string(),
      customerId: dimension.string({ column: 'customer_id' }),
      status: dimension.string({ label: 'Status', filterable: false }),
      createdAt: dimension.timestamp({ column: 'created_at' }),
      amount: dimension.number(),
    },
    measures: {
      revenue: measure.sum('amount', { label: 'Revenue' }),
      orderCount: measure.count('id'),
    },
    filters: {
      status: {
        __type: 'filter_definition',
        field: 'status',
        operators: ['eq', 'in'],
      },
    },
    relationships: {
      customer: belongsTo(() => Customers, { from: 'customerId', to: 'id' }),
    },
    limits: {
      maxMeasures: 2,
    },
  });
  const revenue = Orders.metric('revenue', {
    measure: 'revenue',
    label: 'Revenue KPI',
  });

  it('normalizes a dataset instance into catalog metadata', () => {
    const catalog = getDatasetCatalog(Orders);

    expect(catalog).toMatchObject({
      name: 'orders',
      source: 'orders',
      tenantKey: 'tenant_id',
      timeKey: 'created_at',
      limits: { maxMeasures: 2 },
      requiresTenant: true,
      supportedGrains: ['day', 'week', 'month', 'quarter', 'year'],
      orderableFields: ['id', 'customerId', 'status', 'createdAt', 'amount', 'revenue', 'orderCount', 'period'],
    });
    expect(catalog.dimensions.status).toMatchObject({
      type: 'string',
      label: 'Status',
      filterable: false,
      groupable: true,
    });
    expect(catalog.dimensions.customerId).toMatchObject({
      type: 'string',
      column: 'customer_id',
    });
    expect(catalog.measures.revenue).toMatchObject({
      aggregation: 'sum',
      field: 'amount',
      label: 'Revenue',
      filterCount: 0,
    });
    expect(catalog.metrics).toEqual({});
    expect(catalog.filters.status).toMatchObject({
      field: 'status',
      operators: ['eq', 'in'],
      valueType: 'string',
    });
    expect(catalog.relationships.customer).toMatchObject({
      kind: 'belongsTo',
      target: 'customers',
      from: 'customerId',
      to: 'id',
      execution: 'metadata_only',
    });
  });

  it('includes named metrics when a registry attaches them to a dataset', () => {
    const catalog = getDatasetCatalog({
      ...Orders,
      metrics: { revenue },
    });

    expect(catalog.metrics.revenue).toMatchObject({
      kind: 'metric',
      dataset: 'orders',
      valueType: 'number',
      label: 'Revenue KPI',
      dimensions: ['id', 'customerId', 'status', 'createdAt', 'amount'],
      measures: ['revenue', 'orderCount'],
      filters: ['status'],
      grains: ['day', 'week', 'month', 'quarter', 'year'],
    });
  });

  it('normalizes a dataset registry', () => {
    const catalogs = getDatasetCatalogs({ orders: Orders, customers: Customers });

    expect(Object.keys(catalogs)).toEqual(['orders', 'customers']);
    expect(catalogs.customers.source).toBe('customers');
  });
});
