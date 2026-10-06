import { describe, expect, it } from 'vitest';
import { createQueryBuilder } from '../../clickhouse/src/index.js';
import { dataset, dimension, measure, belongsTo, hasOne, hasMany, createDatasetClient, getDatasetCatalog, serializeSemanticContract, buildProtocolDatasetContract, rehydrateProtocolDatasets } from './index.js';
import { createInMemoryBackend } from './in-memory-backend.js';
import type { RelationshipJoin, RelationshipKey } from './types.js';

const Customers = dataset('compositeCustomers', { source: 'customers', tenantKey: 'tenant', dimensions: { id: dimension.number(), name: dimension.string() }, measures: { minimum: measure.min('score') } });
const keys = [{ from: 'customer_id', to: 'id' }, { from: 'region_code', to: 'region' }] as const;
const Orders = dataset('compositeOrders', { source: 'orders', dimensions: { status: dimension.string() }, measures: { revenue: measure.sum('amount') }, relationships: { customer: belongsTo(() => Customers, { keys }) } });
const client = createDatasetClient({ queryBuilder: createQueryBuilder({ host: 'http://localhost:8123' }) });
const context = { runtime: { tenant: { id: 'a' } } };

describe('composite relationships', () => {
  it('joins every pair with AND and keeps tenant values parameterized', () => {
    const sql = client.toSQL(Orders, { dimensions: ['customer.name'], measures: ['revenue'], filters: [{ field: 'customer.name', operator: 'eq', value: 'Ada' }] }, context);
    expect(sql).toContain('ON orders.customer_id = customer.id AND orders.region_code = customer.region AND customer.tenant =');
    expect((sql.match(/LEFT ANY JOIN/g) ?? []).length).toBe(1);
  });
  it('projects all target keys when selecting related measures', () => {
    const sql = client.toSQL(Orders, { measures: ['customer.minimum'] }, context);
    expect(sql).toContain('`region`');
    expect(sql).toContain('orders.region_code = customer.region');
    expect(sql).toContain('isNotNull(customer._hq_match)');
  });
  it('snapshots authored key arrays', () => {
    const authored: [RelationshipKey, RelationshipKey] = [{ from: 'customer_id', to: 'id' }, { from: 'region_code', to: 'region' }];
    const relationship = hasOne(() => Customers, { keys: authored });
    authored.pop();
    expect(relationship.keys).toEqual(keys);
    expect(Object.isFrozen(relationship.keys)).toBe(true);
  });
  it.each([
    { keys: [] }, { keys: [{ from: 'id', to: 'id' }], from: 'id', to: 'id' },
    { keys: [{ from: 'id; DROP TABLE x', to: 'id' }] }, { keys: [{ from: 'id', to: 'x.id' }] },
    { keys: [{ from: 'id', to: 'id' }, { from: 'id', to: 'region' }] },
    { keys: [{ from: 'id', to: 'id' }, { from: 'region', to: 'id' }] },
  ])('rejects malformed authored keys %j', join => {
    expect(() => belongsTo(() => Customers, join as unknown as RelationshipJoin)).toThrow(/Relationship keys/);
  });
  it('advertises and serializes complete keys without changing legacy metadata', () => {
    expect(getDatasetCatalog(Orders).relationships.customer.keys).toEqual(keys);
    expect(serializeSemanticContract({ orders: Orders }).datasets.orders.relationships.customer.keys).toEqual(keys);
    const legacy = belongsTo(() => Customers, { from: 'customer_id', to: 'id' });
    expect(legacy).not.toHaveProperty('keys');
    expect(hasMany(() => Customers, { keys }).keys).toEqual(keys);
  });
  it('serializes a single authored pair exactly like from/to', () => {
    const withCustomer = (customer: ReturnType<typeof belongsTo>) =>
      dataset('singleKeyOrders', { source: 'orders', dimensions: { status: dimension.string() }, relationships: { customer } });
    const byKeys = withCustomer(belongsTo(() => Customers, { keys: [{ from: 'customer_id', to: 'id' }] }));
    const byFields = withCustomer(belongsTo(() => Customers, { from: 'customer_id', to: 'id' }));
    expect(byKeys.relationships.customer).not.toHaveProperty('keys');
    expect(getDatasetCatalog(byKeys)).toEqual(getDatasetCatalog(byFields));
    expect(serializeSemanticContract({ orders: byKeys })).toEqual(serializeSemanticContract({ orders: byFields }));
  });
  it('round-trips composite keys through the portable protocol contract', () => {
    const endpoint = { access: { kind: 'public' }, tenant: { kind: 'not-required' } } as const;
    const contracts = [Customers, Orders].map(ds => buildProtocolDatasetContract(ds, { endpoint }));
    const restored = rehydrateProtocolDatasets(contracts);
    const restoredKeys = restored.compositeOrders.relationships.customer.keys!;
    expect(restoredKeys).toEqual(keys);
    expect(Object.isFrozen(restoredKeys)).toBe(true);
    expect(restoredKeys.every(Object.isFrozen)).toBe(true);
    expect(Reflect.set(restoredKeys[1], 'to', 'changed')).toBe(false);
    expect(restoredKeys).toEqual(keys);
    const sql = client.toSQL(restored.compositeOrders, { dimensions: ['customer.name'], measures: ['revenue'] }, context);
    expect(sql).toContain('orders.region_code = customer.region');
  });
  it('keeps legacy from/to free of composite identifier rules', () => {
    const subcolumn = belongsTo(() => Customers, { from: 'payload.customer_id', to: 'id' });
    expect(subcolumn).toMatchObject({ from: 'payload.customer_id', to: 'id' });
    expect(subcolumn).not.toHaveProperty('keys');
    const Events = dataset('legacySubcolumnEvents', { source: 'events', dimensions: { status: dimension.string() }, relationships: { customer: subcolumn } });
    expect(client.toSQL(Events, { dimensions: ['customer.name'] }, context)).toContain('ON events.payload.customer_id = customer.id');
  });
  it('rejects hand-built definitions whose from/to disagree with the first pair', () => {
    const relationship = { ...belongsTo(() => Customers, { keys }), from: 'other_id' };
    expect(() => dataset('mismatchedOrders', { source: 'orders', dimensions: {}, relationships: { customer: relationship } }))
      .toThrow(/must match the first keys pair/);
  });
  it('joins composite and single-key relationships in one query', () => {
    const Regions = dataset('compositeRegions', { source: 'regions', dimensions: { label: dimension.string() } });
    const Mixed = dataset('mixedOrders', { source: 'orders', dimensions: { status: dimension.string() }, measures: { revenue: measure.sum('amount') }, relationships: { customer: belongsTo(() => Customers, { keys }), region: belongsTo(() => Regions, { from: 'region_code', to: 'code' }) } });
    const sql = client.toSQL(Mixed, { dimensions: ['customer.name', 'region.label'], measures: ['revenue'] }, context);
    expect(sql).toContain('ON orders.customer_id = customer.id AND orders.region_code = customer.region AND customer.tenant =');
    expect(sql).toContain('ON orders.region_code = region.code');
    expect((sql.match(/LEFT ANY JOIN/g) ?? []).length).toBe(2);
  });
  it('rejects portable keys that disagree with from/to or hold a single pair', () => {
    const endpoint = { access: { kind: 'public' }, tenant: { kind: 'not-required' } } as const;
    const portable = () => [Customers, Orders].map(ds => JSON.parse(JSON.stringify(buildProtocolDatasetContract(ds, { endpoint }))));
    const mismatched = portable();
    mismatched[1].relationships[0].from = 'other_id';
    expect(() => rehydrateProtocolDatasets(mismatched)).toThrow(/must match the first keys pair/);
    const single = portable();
    single[1].relationships[0].keys = [keys[0]];
    expect(() => rehydrateProtocolDatasets(single)).toThrow(/at least two pairs/);
  });
  it('refuses composite traversal on the frozen backend', () => {
    const backend = createDatasetClient({ backend: createInMemoryBackend({ orders: [], customers: [] }) });
    expect(() => backend.execute(Orders, { dimensions: ['customer.name'], measures: ['revenue'] }, context)).toThrow(/queryBuilder execution path/);
  });
  it('refuses composite traversal on builders without leftAnyJoin', () => {
    const db = createQueryBuilder<Record<string, Record<string, 'String'>>>({ host: 'http://localhost:8123' });
    const factory = { table: (name: string) => { const qb = db.table(name); Object.defineProperty(qb, 'leftAnyJoin', { value: undefined }); return qb; }, rawQuery: async () => [] };
    const unsupported = createDatasetClient({ queryBuilder: factory });
    expect(() => unsupported.toSQL(Orders, { dimensions: ['customer.name'] }, context)).toThrow(/does not implement leftAnyJoin/);
  });
});
