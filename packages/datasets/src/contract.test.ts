import { describe, expect, it } from 'vitest';
import { dataset } from './dataset.js';
import { dimension } from './field.js';
import { measure } from './measure.js';
import { belongsTo } from './relationships.js';
import {
  divide,
  serializeSemanticContract,
  contractToStableJson,
  hashContract,
  SEMANTIC_CONTRACT_VERSION,
  type DatasetCatalogSource,
} from './index.js';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

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

function makeOrders() {
  return dataset('orders', {
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
      maxDimensions: 4,
    },
  });
}

const Orders = makeOrders();

/** Serializes and strips the content hash for structural comparisons. */
function contractBody(datasets: Record<string, DatasetCatalogSource>) {
  const { contentHash, ...rest } = serializeSemanticContract(datasets);
  return rest;
}

function hashOf(datasets: Record<string, DatasetCatalogSource>): string {
  return serializeSemanticContract(datasets).contentHash;
}

// ---------------------------------------------------------------------------
// Shape
// ---------------------------------------------------------------------------

describe('semantic contract — shape', () => {
  it('serializes a full dataset into the contract surface', () => {
    const contract = serializeSemanticContract({ orders: Orders });

    expect(contract.version).toBe(SEMANTIC_CONTRACT_VERSION);
    expect(contract.contentHash).toMatch(/^[a-f0-9]{64}$/);

    expect(contract.datasets.orders).toMatchObject({
      name: 'orders',
      source: 'orders',
      tenantKey: 'tenant_id',
      timeKey: 'created_at',
      requiresTenant: true,
      supportedGrains: ['day', 'month', 'quarter', 'week', 'year'],
      limits: { maxDimensions: 4, maxMeasures: 2 },
    });
    expect(contract.datasets.orders.dimensions.customerId).toEqual({
      type: 'string',
      column: 'customer_id',
      filterable: true,
      groupable: true,
    });
    expect(contract.datasets.orders.dimensions.status).toMatchObject({
      type: 'string',
      label: 'Status',
      filterable: false,
    });
    expect(contract.datasets.orders.measures.revenue).toEqual({
      aggregation: 'sum',
      field: 'amount',
      label: 'Revenue',
    });
    expect(contract.datasets.orders.filters.status).toEqual({
      field: 'status',
      operators: ['eq', 'in'],
      valueType: 'string',
    });
    expect(contract.datasets.orders.relationships.customer).toEqual({
      kind: 'belongsTo',
      target: 'customers',
      from: 'customerId',
      to: 'id',
    });
  });

  it('omits catalog-only convenience/derived fields', () => {
    const contract = serializeSemanticContract({ orders: Orders });
    const ds = contract.datasets.orders as Record<string, unknown>;

    // Derived conveniences from the catalog are intentionally not in the contract.
    expect(ds).not.toHaveProperty('orderableFields');
    expect(ds).not.toHaveProperty('maxLimit');
    expect(contract.datasets.orders.measures.revenue).not.toHaveProperty('filterCount');
    expect(contract.datasets.orders.relationships.customer).not.toHaveProperty('execution');
  });

  it('drops optional fields when absent rather than emitting undefined', () => {
    const contract = serializeSemanticContract({ customers: Customers });
    const customers = contract.datasets.customers as Record<string, unknown>;

    expect(customers).not.toHaveProperty('tenantKey');
    expect(customers).not.toHaveProperty('timeKey');
    expect(customers).not.toHaveProperty('limits');
    expect(customers.requiresTenant).toBe(false);
    expect(customers.supportedGrains).toEqual([]);
    expect(contract.datasets.customers.dimensions.id).not.toHaveProperty('label');
  });
});

// ---------------------------------------------------------------------------
// Determinism — equal models hash identically
// ---------------------------------------------------------------------------

describe('semantic contract — determinism', () => {
  it('produces identical output regardless of dataset input order', () => {
    const a = contractBody({ orders: Orders, customers: Customers });
    const b = contractBody({ customers: Customers, orders: Orders });

    expect(contractToStableJson(a)).toBe(contractToStableJson(b));
    expect(hashOf({ orders: Orders, customers: Customers })).toBe(
      hashOf({ customers: Customers, orders: Orders }),
    );
  });

  it('is independent of dimension/measure declaration order', () => {
    const A = dataset('orders', {
      source: 'orders',
      dimensions: { a: dimension.string(), b: dimension.string() },
      measures: { x: measure.count('a'), y: measure.count('b') },
    });
    const B = dataset('orders', {
      source: 'orders',
      dimensions: { b: dimension.string(), a: dimension.string() },
      measures: { y: measure.count('b'), x: measure.count('a') },
    });

    expect(hashOf({ orders: A })).toBe(hashOf({ orders: B }));
    // Keys are emitted in sorted order.
    expect(Object.keys(contractBody({ orders: B }).datasets.orders.dimensions)).toEqual(['a', 'b']);
  });

  it('is independent of the author-controlled limits key order', () => {
    const A = dataset('orders', {
      source: 'orders',
      dimensions: { id: dimension.string() },
      measures: { c: measure.count('id') },
      limits: { maxMeasures: 2, maxDimensions: 5 },
    });
    const B = dataset('orders', {
      source: 'orders',
      dimensions: { id: dimension.string() },
      measures: { c: measure.count('id') },
      limits: { maxDimensions: 5, maxMeasures: 2 },
    });

    expect(hashOf({ orders: A })).toBe(hashOf({ orders: B }));
  });

  it('sorts and de-duplicates filter operators', () => {
    const A = dataset('orders', {
      source: 'orders',
      dimensions: { status: dimension.string() },
      measures: { c: measure.count('status') },
      filters: {
        status: { __type: 'filter_definition', field: 'status', operators: ['in', 'eq', 'eq'] },
      },
    });

    const contract = serializeSemanticContract({ orders: A });
    expect(contract.datasets.orders.filters.status.operators).toEqual(['eq', 'in']);
  });

  it('round-trips hashContract over the hash-free body', () => {
    const contract = serializeSemanticContract({ orders: Orders });
    const { contentHash, ...withoutHash } = contract;

    expect(hashContract(withoutHash)).toBe(contentHash);
    // Recomputing from a fresh serialization is stable too.
    expect(serializeSemanticContract({ orders: Orders }).contentHash).toBe(contentHash);
  });

  it('contractToStableJson is 2-space indented and round-trips', () => {
    const contract = serializeSemanticContract({ orders: Orders });
    const json = contractToStableJson(contract);

    expect(json).toContain('\n  "version"');
    expect(JSON.parse(json)).toEqual(contract);
  });
});

// ---------------------------------------------------------------------------
// SQL normalization
// ---------------------------------------------------------------------------

describe('semantic contract — SQL normalization', () => {
  it('normalizes SQL whitespace/indentation in the serialized value', () => {
    const A = dataset('orders', {
      source: 'orders',
      dimensions: {
        bucket: dimension.string({ sql: '   upper(status)   ' }),
      },
      measures: { c: measure.count('bucket') },
    });

    const contract = serializeSemanticContract({ orders: A });
    expect(contract.datasets.orders.dimensions.bucket.sql).toBe('upper(status)');
  });

  it('ignores whitespace-only SQL differences in the hash', () => {
    const A = dataset('orders', {
      source: 'orders',
      dimensions: { bucket: dimension.string({ sql: 'upper(status)' }) },
      measures: { c: measure.count('bucket') },
    });
    const B = dataset('orders', {
      source: 'orders',
      dimensions: { bucket: dimension.string({ sql: '\n   upper(status)  \n' }) },
      measures: { c: measure.count('bucket') },
    });

    expect(hashOf({ orders: A })).toBe(hashOf({ orders: B }));
  });

  it('reflects a meaningful SQL change in the hash', () => {
    const A = dataset('orders', {
      source: 'orders',
      dimensions: { bucket: dimension.string({ sql: 'upper(status)' }) },
      measures: { c: measure.count('bucket') },
    });
    const B = dataset('orders', {
      source: 'orders',
      dimensions: { bucket: dimension.string({ sql: 'lower(status)' }) },
      measures: { c: measure.count('bucket') },
    });

    expect(hashOf({ orders: A })).not.toBe(hashOf({ orders: B }));
  });

  it('includes SQL by default and omits it when includeSql is false', () => {
    const A = dataset('orders', {
      source: 'orders',
      dimensions: { bucket: dimension.string({ sql: 'upper(status)' }) },
      measures: { revenue: measure.sum('amount', { sql: 'sum(amount)' }) },
    });

    const withSql = serializeSemanticContract({ orders: A });
    expect(withSql.datasets.orders.dimensions.bucket.sql).toBe('upper(status)');
    expect(withSql.datasets.orders.measures.revenue.sql).toBe('sum(amount)');

    const redacted = serializeSemanticContract({ orders: A }, { includeSql: false });
    expect(redacted.datasets.orders.dimensions.bucket).not.toHaveProperty('sql');
    expect(redacted.datasets.orders.measures.revenue).not.toHaveProperty('sql');
    // Redaction changes the hash (different serialized surface).
    expect(redacted.contentHash).not.toBe(withSql.contentHash);
  });
});

// ---------------------------------------------------------------------------
// Hash sensitivity — meaningful changes flip the hash
// ---------------------------------------------------------------------------

describe('semantic contract — breaking-change sensitivity', () => {
  const baseline = hashOf({ orders: Orders });

  it('changes when a dimension is added', () => {
    const next = dataset('orders', {
      source: 'orders',
      tenantKey: 'tenant_id',
      timeKey: 'created_at',
      dimensions: {
        id: dimension.string(),
        customerId: dimension.string({ column: 'customer_id' }),
        status: dimension.string({ label: 'Status', filterable: false }),
        amount: dimension.number(),
        channel: dimension.string(),
      },
      measures: { revenue: measure.sum('amount'), orderCount: measure.count('id') },
    });
    expect(hashOf({ orders: next })).not.toBe(baseline);
  });

  it('changes when a dimension type changes', () => {
    const next = dataset('orders', {
      source: 'orders',
      tenantKey: 'tenant_id',
      timeKey: 'created_at',
      dimensions: {
        id: dimension.string(),
        customerId: dimension.string({ column: 'customer_id' }),
        status: dimension.string({ label: 'Status', filterable: false }),
        amount: dimension.string(), // was number
      },
      measures: { revenue: measure.sum('amount'), orderCount: measure.count('id') },
    });
    expect(hashOf({ orders: next })).not.toBe(baseline);
  });

  it('changes when a measure aggregation changes', () => {
    const next = makeOrdersWith({ revenueAgg: 'avg' });
    expect(hashOf({ orders: next })).not.toBe(baseline);
  });

  it('changes when the tenant policy changes', () => {
    const next = dataset('orders', {
      source: 'orders',
      timeKey: 'created_at', // tenantKey removed
      dimensions: {
        id: dimension.string(),
        customerId: dimension.string({ column: 'customer_id' }),
        status: dimension.string({ label: 'Status', filterable: false }),
        amount: dimension.number(),
      },
      measures: { revenue: measure.sum('amount'), orderCount: measure.count('id') },
    });
    expect(hashOf({ orders: next })).not.toBe(baseline);
  });

  it('changes when a named metric is added', () => {
    const withMetric: DatasetCatalogSource = {
      ...Orders,
      metrics: { revenueKpi: Orders.metric('revenueKpi', { measure: 'revenue' }) },
    };
    expect(hashOf({ orders: withMetric })).not.toBe(baseline);
  });

  function makeOrdersWith(opts: { revenueAgg: 'sum' | 'avg' }) {
    return dataset('orders', {
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
        revenue:
          opts.revenueAgg === 'sum' ? measure.sum('amount') : measure.avg('amount'),
        orderCount: measure.count('id'),
      },
    });
  }
});

// ---------------------------------------------------------------------------
// Metrics
// ---------------------------------------------------------------------------

describe('semantic contract — metrics', () => {
  it('captures base and derived metric kinds with sorted field lists', () => {
    const revenueKpi = Orders.metric('revenueKpi', { measure: 'revenue', label: 'Revenue KPI' });
    const avgOrder = Orders.metric('avgOrder', {
      uses: { revenue: revenueKpi },
      formula: ({ revenue }) => divide(revenue, revenue),
    });

    const withMetrics: DatasetCatalogSource = {
      ...Orders,
      metrics: { revenueKpi, avgOrder },
    };

    const contract = serializeSemanticContract({ orders: withMetrics });
    expect(contract.datasets.orders.metrics.revenueKpi).toMatchObject({
      kind: 'metric',
      valueType: 'number',
      label: 'Revenue KPI',
    });
    expect(contract.datasets.orders.metrics.avgOrder.kind).toBe('derived_metric');
    // Dimension list is sorted.
    const dims = contract.datasets.orders.metrics.revenueKpi.dimensions;
    expect([...dims].sort()).toEqual(dims);
  });
});

// ---------------------------------------------------------------------------
// Empty / edge inputs
// ---------------------------------------------------------------------------

describe('semantic contract — edge inputs', () => {
  it('serializes an empty registry', () => {
    const contract = serializeSemanticContract({});
    expect(contract).toMatchObject({ version: SEMANTIC_CONTRACT_VERSION, datasets: {} });
    expect(contract.contentHash).toMatch(/^[a-f0-9]{64}$/);
  });

  it('serializes a minimal dataset with empty relationships/metrics', () => {
    const Empty = dataset('empty', {
      source: 'empty',
      dimensions: { id: dimension.string() },
      measures: { c: measure.count('id') },
    });
    const contract = serializeSemanticContract({ empty: Empty });

    expect(contract.datasets.empty.relationships).toEqual({});
    expect(contract.datasets.empty.metrics).toEqual({});
  });

  it('captures filters auto-derived from filterable dimensions (default operators)', () => {
    const Auto = dataset('auto', {
      source: 'auto',
      dimensions: {
        country: dimension.string(),
        secret: dimension.string({ filterable: false }),
      },
      measures: { c: measure.count('country') },
      // No explicit `filters` → derived from filterable dimensions only.
    });
    const contract = serializeSemanticContract({ auto: Auto });

    expect(Object.keys(contract.datasets.auto.filters)).toEqual(['country']);
    // Default operator set is applied and sorted.
    expect(contract.datasets.auto.filters.country.operators).toEqual([
      'between', 'eq', 'gt', 'gte', 'in', 'like', 'lt', 'lte', 'neq', 'notIn',
    ]);
  });

  it('keys the contract by the registry key, not the dataset name', () => {
    const contract = serializeSemanticContract({ ordersAlias: Orders });
    expect(Object.keys(contract.datasets)).toEqual(['ordersAlias']);
    expect(contract.datasets.ordersAlias.name).toBe('orders');
  });
});
