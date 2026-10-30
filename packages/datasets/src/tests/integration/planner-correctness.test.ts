/**
 * Planner answers against ClickHouse, compared with hand-written SQL. Each case
 * is one the SQL text alone would not catch: how ClickHouse resolves a name,
 * joins a reused key, or divides a Decimal. Mirrors
 * python/hypequery/tests/test_planner_correctness_live.py.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createQueryBuilder } from '../../../../clickhouse/src/index.js';
import { belongsTo, checkRelationships, createDatasetClient, dataset, dimension, measure } from '../../index.js';
import { divide, nullIfZero, round } from '../../formulas.js';
import { TEST_CONNECTION_CONFIG, insertRows, runSql } from '../../../../../testing/clickhouse/harness.mjs';

const customersTable = 'correctness_customers';
const ordersTable = 'correctness_orders';
const nullKeysTable = 'correctness_null_keys';

const Customers = dataset('correctnessCustomers', {
  source: customersTable,
  tenantKey: 'tenant_id',
  dimensions: { id: dimension.string(), name: dimension.string() },
});
const Orders = dataset('correctnessOrders', {
  source: ordersTable,
  tenantKey: 'tenant_id',
  dimensions: {
    id: dimension.string(),
    // Named like other columns: `status` reads `country`, as a renamed column would.
    status: dimension.string({ column: 'country' }),
    orderStatus: dimension.string({ column: 'status' }),
    orderAmount: dimension.number({ column: 'amount' }),
  },
  measures: {
    amount: measure.sum('amount'),
    largest: measure.max('amount'),
    orders: measure.count('id'),
    paid: measure.sum('amount', { filters: [{ field: 'orderStatus', operator: 'eq', value: 'paid' }] }),
    average: measure.derived({
      uses: { amount: 'amount', orders: 'orders' },
      formula: ({ amount, orders }) => round(divide(amount, nullIfZero(orders)), 2),
    }),
    paidShare: measure.derived({
      uses: { paid: 'paid', amount: 'amount' },
      formula: ({ paid, amount }) => divide(paid, nullIfZero(amount)),
    }),
  },
  relationships: { customer: belongsTo(() => Customers, { from: 'customer_id', to: 'id' }) },
});

// c1 is duplicated within tenant a, beside a NULL key that never joins.
const NullKeyCustomers = dataset('correctnessNullKeyCustomers', {
  source: nullKeysTable,
  tenantKey: 'tenant_id',
  dimensions: { name: dimension.string() },
});
const NullKeyOrders = dataset('correctnessNullKeyOrders', {
  source: ordersTable,
  tenantKey: 'tenant_id',
  dimensions: { id: dimension.string() },
  relationships: { customer: belongsTo(() => NullKeyCustomers, { from: 'customer_id', to: 'id' }) },
});

const db = createQueryBuilder({
  host: TEST_CONNECTION_CONFIG.host,
  username: TEST_CONNECTION_CONFIG.user,
  password: TEST_CONNECTION_CONFIG.password,
  database: TEST_CONNECTION_CONFIG.database,
});
const client = createDatasetClient({ queryBuilder: db });
const tenantA = { runtime: { tenant: { id: 'a' } } };

describe('planner correctness against ClickHouse', () => {
  beforeAll(async () => {
    await runSql(`CREATE TABLE ${customersTable} (tenant_id String, id String, name String) ENGINE = MergeTree ORDER BY tuple()`);
    await runSql(`CREATE TABLE ${nullKeysTable} (tenant_id String, id Nullable(String), name String) ENGINE = MergeTree ORDER BY tuple()`);
    await insertRows(nullKeysTable, [
      { tenant_id: 'a', id: 'c1', name: 'First' },
      { tenant_id: 'a', id: 'c1', name: 'Second' },
      { tenant_id: 'a', id: null, name: 'Unkeyed' },
    ]);
    await runSql(`CREATE TABLE ${ordersTable} (tenant_id String, id String, customer_id String, country String, status String, amount Decimal(12, 2)) ENGINE = MergeTree ORDER BY tuple()`);
    // Customer c1 exists in both tenants; a join on the key alone mixes them.
    await insertRows(customersTable, [
      { tenant_id: 'a', id: 'c1', name: 'Alpha One' },
      { tenant_id: 'a', id: 'c2', name: 'Alpha Two' },
      { tenant_id: 'b', id: 'c1', name: 'Beta One' },
    ]);
    // Tenant a's amounts sum to 2.00 over 3 orders: an exact average of 0.666...
    await insertRows(ordersTable, [
      { tenant_id: 'a', id: 'o1', customer_id: 'c1', country: 'NZ', status: 'paid', amount: '0.70' },
      { tenant_id: 'a', id: 'o2', customer_id: 'c1', country: 'NZ', status: 'paid', amount: '0.67' },
      { tenant_id: 'a', id: 'o3', customer_id: 'c2', country: 'AU', status: 'refunded', amount: '0.63' },
      { tenant_id: 'b', id: 'o1', customer_id: 'c1', country: 'DE', status: 'paid', amount: '4000.00' },
      { tenant_id: 'b', id: 'o2', customer_id: 'c1', country: 'US', status: 'paid', amount: '3000.00' },
    ]);
  });

  afterAll(async () => {
    for (const table of [ordersTable, customersTable, nullKeysTable]) await runSql(`DROP TABLE IF EXISTS ${table}`);
  });

  it.each([
    ['several tenants', { runtime: { tenant: { in: ['a', 'b'] } } }],
    ['all tenants', { runtime: { tenant: { scope: 'all' as const } } }],
  ])('joins each row within its own tenant across %s', async (_label, context) => {
    const { data } = await client.execute(Orders, {
      dimensions: ['customer.name'],
      measures: ['amount'],
      orderBy: [{ field: 'customer.name', direction: 'asc' }],
    }, context);
    expect(data).toEqual([
      { 'customer.name': 'Alpha One', amount: '1.37' },
      { 'customer.name': 'Alpha Two', amount: '0.63' },
      { 'customer.name': 'Beta One', amount: '7000' },
    ]);
  });

  it('does not report a key reused by another tenant as a duplicate', async () => {
    for (const tenant of [{ id: 'a' }, { in: ['a', 'b'] }, { scope: 'all' as const }]) {
      expect(await checkRelationships(Orders, { queryBuilder: db, context: { runtime: { tenant } } }))
        .toEqual({ ok: true, checked: ['customer'], issues: [] });
    }
  });

  it('still reports a duplicate key beside a NULL key in every scope', async () => {
    // count() skips the NULL key; a (key, tenant) pair must not count it either.
    for (const tenant of [{ id: 'a' }, { in: ['a', 'b'] }, { scope: 'all' as const }]) {
      const result = await checkRelationships(NullKeyOrders, { queryBuilder: db, context: { runtime: { tenant } } });
      expect(result.ok).toBe(false);
      expect(result.issues).toHaveLength(1);
    }
  });

  it('never lets an output alias capture a column of the same name', async () => {
    const { data } = await client.execute(Orders, {
      dimensions: ['status', 'orderStatus'],
      measures: ['amount', 'largest'],
      filters: [
        { field: 'orderStatus', operator: 'eq', value: 'paid' },
        { field: 'orderAmount', operator: 'gt', value: 0.5 },
      ],
    }, tenantA);
    expect(data).toEqual([{ status: 'NZ', orderStatus: 'paid', amount: '1.37', largest: '0.7' }]);
  });

  it('does not truncate a derived division to the Decimal scale', async () => {
    const { data } = await client.execute(Orders, { measures: ['average', 'paidShare'] }, tenantA);
    // 2.00 / 3 rounds to 0.67; Decimal division truncated it to 0.66 first.
    expect(Number(data[0]?.average)).toBeCloseTo(0.67, 10);
    // 1.37 / 2.00 is 0.685; Decimal / Decimal kept two places and gave 0.68.
    expect(Number(data[0]?.paidShare)).toBeCloseTo(0.685, 10);
  });
});
