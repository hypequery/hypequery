import { describe, expect, it } from 'vitest';
import { dataset } from './dataset.js';
import { dimension } from './field.js';
import { measure } from './measure.js';
import { belongsTo } from './relationships.js';
import {
  serializeSemanticContract,
  contractToStableJson,
  hashContract,
  SEMANTIC_CONTRACT_VERSION,
} from './contract.js';

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
      operators: ['in', 'eq'],
    },
  },
  relationships: {
    customer: belongsTo(() => Customers, { from: 'customerId', to: 'id' }),
  },
  limits: {
    maxMeasures: 2,
  },
});

describe('semantic contract', () => {
  it('serializes datasets into a versioned, hashed contract', () => {
    const contract = serializeSemanticContract({ orders: Orders, customers: Customers });

    expect(contract.version).toBe(SEMANTIC_CONTRACT_VERSION);
    expect(contract.contentHash).toMatch(/^[a-f0-9]{64}$/);
    expect(contract.datasets.orders).toMatchObject({
      name: 'orders',
      source: 'orders',
      tenantKey: 'tenant_id',
      timeKey: 'created_at',
      requiresTenant: true,
      limits: { maxMeasures: 2 },
    });
    expect(contract.datasets.orders.filters.status).toMatchObject({
      field: 'status',
      valueType: 'string',
    });
  });

  it('sorts dataset keys, field keys, and unordered arrays deterministically', () => {
    const contract = serializeSemanticContract({ orders: Orders, customers: Customers });

    // Dataset keys sorted, regardless of input order.
    expect(Object.keys(contract.datasets)).toEqual(['customers', 'orders']);
    // Dimension keys sorted.
    expect(Object.keys(contract.datasets.orders.dimensions)).toEqual([
      'amount',
      'customerId',
      'id',
      'status',
    ]);
    // Operators sorted, regardless of declaration order (declared ['in','eq']).
    expect(contract.datasets.orders.filters.status.operators).toEqual(['eq', 'in']);
    // Grains sorted.
    expect(contract.datasets.orders.supportedGrains).toEqual([
      'day',
      'month',
      'quarter',
      'week',
      'year',
    ]);
  });

  it('produces the same hash regardless of dataset input order', () => {
    const a = serializeSemanticContract({ orders: Orders, customers: Customers });
    const b = serializeSemanticContract({ customers: Customers, orders: Orders });

    expect(a.contentHash).toBe(b.contentHash);
    expect(contractToStableJson(a)).toBe(contractToStableJson(b));
  });

  it('changes the hash when a meaningful field changes', () => {
    const baseline = serializeSemanticContract({ orders: Orders });

    const Renamed = dataset('orders', {
      source: 'orders',
      tenantKey: 'tenant_id',
      timeKey: 'created_at',
      dimensions: {
        id: dimension.string(),
        customerId: dimension.string({ column: 'customer_id' }),
        status: dimension.string({ label: 'Status', filterable: false }),
        amount: dimension.number(),
        // Added dimension changes the semantic surface.
        channel: dimension.string(),
      },
      measures: {
        revenue: measure.sum('amount', { label: 'Revenue' }),
        orderCount: measure.count('id'),
      },
    });
    const changed = serializeSemanticContract({ orders: Renamed });

    expect(changed.contentHash).not.toBe(baseline.contentHash);
  });

  it('hashContract excludes the contentHash field itself (stable round-trip)', () => {
    const contract = serializeSemanticContract({ orders: Orders });
    const { contentHash, ...withoutHash } = contract;

    expect(hashContract(withoutHash)).toBe(contentHash);
  });
});
