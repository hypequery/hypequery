import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { getDatasetCatalogs } from './catalog.js';
import { dataset } from './dataset.js';
import { dimension } from './field.js';
import { measure } from './measure.js';
import { belongsTo, hasMany, hasOne } from './relationships.js';

/**
 * Cross-language catalog parity. The same model is defined natively in Python
 * (`python/hypequery/tests/test_dataset_catalog.py`); both sides assert against
 * the one shared fixture, so a catalog change in either implementation fails
 * here too rather than drifting apart silently.
 *
 * See `specs/semantic-catalog/README.md` for what the model exercises.
 */
const CATALOG_FIXTURE = join(
  import.meta.dirname,
  '..',
  '..',
  '..',
  'specs',
  'semantic-catalog',
  'catalog.json',
);

const Customers = dataset('customers', {
  source: 'customers',
  dimensions: {
    id: dimension.string(),
    country: dimension.string({ label: 'Country', description: 'ISO country code' }),
    tier: dimension.string({ column: 'customer_tier', groupable: false }),
    fullName: dimension.string({
      sql: "concat(first_name, ' ', last_name)",
      dependencies: ['first_name', 'last_name'],
    }),
  },
  measures: { customerCount: measure.count('id') },
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
    uniqueCustomers: measure.countDistinct('customerId'),
    topStatus: measure.argMax('status', 'amount'),
    p95Amount: measure.percentile('amount', 0.95),
    paidRevenue: measure.sum('amount', {
      filters: [{ field: 'status', operator: 'eq', value: 'paid' }],
    }),
  },
  filters: {
    status: { __type: 'filter_definition', field: 'status', operators: ['eq', 'in'] },
  },
  relationships: {
    customer: belongsTo(() => Customers, { from: 'customerId', to: 'id' }),
    primaryContact: hasOne(() => Customers, { from: 'id', to: 'id' }),
    relatedCustomers: hasMany(() => Customers, { from: 'id', to: 'id' }),
  },
  limits: { maxDimensions: 5, maxFilters: 10, maxResultSize: 1000 },
});

describe('catalog cross-language parity', () => {
  it('matches the shared semantic catalog fixture', () => {
    const catalogs = getDatasetCatalogs({ customers: Customers, orders: Orders });
    const expected = JSON.parse(readFileSync(CATALOG_FIXTURE, 'utf8')) as unknown;

    // Compare through JSON so `undefined` optionals drop exactly as they do on
    // the wire, which is the form the Python catalog is built to match.
    expect(JSON.parse(JSON.stringify(catalogs))).toEqual(expected);
  });
});
