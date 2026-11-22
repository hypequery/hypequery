/**
 * The opt-in analysis features of the canonical query schemas: filter groups
 * and relative dates (RFC 0029), `fill`, and query-scoped calculations with
 * `limitBy` and `other` (RFC 0026).
 */

import { describe, expect, it } from 'vitest';
import { belongsTo, dataset, dimension, measure } from './index.js';
import { getDatasetCatalog } from './catalog.js';
import {
  buildCanonicalSemanticQuerySchemas,
  buildDatasetInputProtocolSchema,
  buildDatasetInputSchema,
  buildMetricInputProtocolSchema,
  buildMetricInputSchema,
  type SemanticQuerySchemaOptions,
} from './semantic-query-schema.js';
import { RELATIVE_DATE_RANGES } from './utils/query-schema-filters.js';

const Customers = dataset('customers', {
  source: 'customers',
  dimensions: { id: dimension.string(), tier: dimension.string() },
  measures: { customers: measure.count('id') },
});

const Orders = dataset('orders', {
  source: 'orders',
  timeKey: 'createdAt',
  timeKeys: ['shippedAt'],
  dimensions: {
    createdAt: dimension.timestamp({ column: 'created_at' }),
    shippedAt: dimension.timestamp({ column: 'shipped_at' }),
    country: dimension.string(),
    status: dimension.string(),
    customerId: dimension.string({ column: 'customer_id' }),
    amount: dimension.number(),
  },
  filters: {
    status: { field: 'status', operators: ['eq', 'in', 'isNull'] },
  },
  measures: {
    revenue: measure.sum('amount'),
    orders: measure.count('status'),
    latest: measure.argMax('amount', 'createdAt'),
    running: measure.cumulative('revenue'),
  },
  relationships: {
    customer: belongsTo(() => Customers, { from: 'customerId', to: 'id' }),
  },
});

const Flat = dataset('flat', {
  source: 'flat',
  dimensions: { amount: dimension.number() },
  measures: { total: measure.sum('amount') },
});

const ALL: SemanticQuerySchemaOptions = {
  grainField: 'grain',
  having: true,
  timeKey: true,
  filterGroups: true,
  relativeDates: true,
  fill: true,
  calculations: true,
};

const schema = buildDatasetInputSchema(Orders, ALL);
const accepts = (input: Record<string, unknown>) => schema.safeParse({ measures: ['revenue'], ...input }).success;
const issues = (input: Record<string, unknown>) => {
  const result = schema.safeParse({ measures: ['revenue'], ...input });
  if (result.success) throw new Error('expected a refusal');
  return JSON.stringify(result.error.issues);
};

describe('canonical query schema analysis features', () => {
  it('leaves every existing schema byte-identical while the features are off', () => {
    const base = { grainField: 'grain' as const, having: true, timeKey: true };
    const off = { ...base, filterGroups: false, relativeDates: false, fill: false, calculations: false };
    expect(buildCanonicalSemanticQuerySchemas({ orders: Orders }, off))
      .toMatchObject({ manifestHash: buildCanonicalSemanticQuerySchemas({ orders: Orders }, base).manifestHash });
  });

  it('snapshots the advertised schema with every feature on', () => {
    const schemas = buildCanonicalSemanticQuerySchemas({ orders: Orders }, ALL);
    expect(schemas.queryDatasetJsonSchema).toMatchSnapshot();
    expect(schemas.manifestHash).toMatch(/^[0-9a-f]{64}$/);
  });

  describe('filter groups', () => {
    it('nests and/or/not over comparisons and keeps each field\'s operators', () => {
      expect(accepts({ filters: [{ and: [{ or: [{ field: 'country', operator: 'eq', value: 'US' }, { not: { field: 'status', operator: 'isNull' } }] }] }] })).toBe(true);
      expect(accepts({ filters: [{ or: [{ field: 'status', operator: 'like', value: 'x%' }] }] })).toBe(false);
      expect(accepts({ filters: [{ not: { field: 'status', operator: 'isNull', value: 1 } }] })).toBe(false);
      expect(accepts({ filters: [{ and: [] }] })).toBe(false);
      expect(accepts({ filters: [{ and: [{ field: 'country', operator: 'eq', value: 'US' }], not: { field: 'country', operator: 'eq', value: 'US' } }] })).toBe(false);
    });

    it('accepts relationship fields inside groups', () => {
      expect(accepts({ filters: [{ or: [{ field: 'customer.tier', operator: 'eq', value: 'gold' }, { field: 'country', operator: 'eq', value: 'US' }] }] })).toBe(true);
    });

    it('compacts comparisons into one shape per operator set', () => {
      const json = JSON.stringify(buildCanonicalSemanticQuerySchemas({ orders: Orders }, ALL).queryDatasetJsonSchema);
      expect(json).toContain('"enum":["amount","country","createdAt","customer.id","customer.tier","customerId","shippedAt"]');
      // A field with its own operators keeps its own shape.
      expect(json).toContain('"const":"status"');
    });
  });

  describe('relative dates', () => {
    it('accepts every fixed range and the counted form on each time axis', () => {
      for (const value of [...RELATIVE_DATE_RANGES, 'last 30 days', 'last 1 month', 'last 9999 years']) {
        expect(accepts({ filters: [{ field: 'createdAt', operator: 'inDateRange', value }] })).toBe(true);
      }
      expect(accepts({ filters: [{ field: 'shippedAt', operator: 'inDateRange', value: 'today' }] })).toBe(true);
    });

    it('refuses a range outside the grammar, a non-time field, and a relationship field', () => {
      for (const value of ['last 0 days', 'last 10000 days', 'Last week', 'next week', 3]) {
        expect(accepts({ filters: [{ field: 'createdAt', operator: 'inDateRange', value }] })).toBe(false);
      }
      expect(accepts({ filters: [{ field: 'country', operator: 'inDateRange', value: 'today' }] })).toBe(false);
      expect(accepts({ filters: [{ field: 'customer.tier', operator: 'inDateRange', value: 'today' }] })).toBe(false);
    });

    it('offers no inDateRange without a time axis', () => {
      const json = JSON.stringify(buildCanonicalSemanticQuerySchemas({ flat: Flat }, ALL).queryDatasetJsonSchema);
      expect(json).not.toContain('inDateRange');
    });
  });

  describe('fill', () => {
    it('is a boolean on a dataset with a time axis', () => {
      expect(accepts({ grain: 'day', fill: true })).toBe(true);
      expect(accepts({ fill: 'true' })).toBe(false);
    });

    it('is absent without a time axis, on metric queries, and while off', () => {
      const shape = (options: SemanticQuerySchemaOptions, source = Orders) =>
        (buildDatasetInputSchema(source, { ...options, requireSelection: false }) as unknown as { shape: Record<string, unknown> }).shape;
      expect(shape(ALL, Flat)).not.toHaveProperty('fill');
      expect(shape({ ...ALL, fill: false })).not.toHaveProperty('fill');
      const total = Orders.metric('total', { measure: 'revenue' });
      const metric = buildMetricInputSchema({ ...Orders, metrics: { total } }, 'total', ALL, total.contract());
      expect(metric.safeParse({ grain: 'day', fill: true }).success).toBe(false);
      // Groups reach metric queries too, over the metric's own filter list.
      expect(metric.safeParse({ filters: [{ or: [{ field: 'status', operator: 'eq', value: 'paid' }, { field: 'status', operator: 'isNull' }] }] }).success).toBe(true);
      expect(metric.safeParse({ calculations: [] }).success).toBe(false);
    });
  });

  describe('calculations', () => {
    it('limits filter calculations to filterable base measures and local non-time fields', () => {
      const where = [{ field: 'country', operator: 'eq', value: 'US' }];
      expect(accepts({ calculations: [{ name: 'us', filter: { measure: 'orders', where } }] })).toBe(true);
      expect(accepts({ calculations: [{ name: 'us', filter: { measure: 'latest', where } }] })).toBe(false);
      expect(accepts({ calculations: [{ name: 'us', filter: { measure: 'running', where } }] })).toBe(false);
      expect(accepts({ calculations: [{ name: 'us', filter: { measure: 'revenue', where: [] } }] })).toBe(false);
      expect(accepts({ calculations: [{ name: 'us', filter: { measure: 'revenue', where: [{ field: 'customer.tier', operator: 'eq', value: 'x' }] } }] })).toBe(false);
      expect(accepts({ calculations: [{ name: 'us', filter: { measure: 'revenue', where: [{ field: 'shippedAt', operator: 'gt', value: 'x' }] } }] })).toBe(false);
    });

    it('bounds shift amounts, window modes and formula arity', () => {
      expect(accepts({ calculations: [{ name: 's', shift: { measure: 'revenue', amount: 1001, unit: 'day' } }] })).toBe(false);
      expect(accepts({ calculations: [{ name: 'w', window: { measure: 'revenue' } }] })).toBe(false);
      expect(accepts({ calculations: [{ name: 'w', window: { measure: 'revenue', toDate: 'minute' } }] })).toBe(false);
      expect(accepts({ calculations: [{ name: 'w', window: { measure: 'revenue', cumulative: false } }] })).toBe(false);
      expect(accepts({ calculations: [{ name: 'f', formula: { op: 'add', args: [] } }] })).toBe(false);
      expect(accepts({ calculations: [{ name: 'f', formula: { op: 'pow', args: ['revenue', 2] } }] })).toBe(false);
      expect(accepts({ calculations: [{ name: 'f', formula: { op: 'percentChange', args: ['revenue', { op: 'coalesce', args: ['orders', 0] }] } }] })).toBe(true);
    });

    it('names partitions and buckets from the dataset\'s own fields', () => {
      expect(accepts({ calculations: [{ name: 'r', rank: { measure: 'revenue', within: ['country', 'period'] } }] })).toBe(true);
      expect(accepts({ calculations: [{ name: 'r', share: { measure: 'revenue', of: ['region'] } }] })).toBe(false);
      expect(accepts({ limitBy: { n: 3, by: ['period'] } })).toBe(true);
      expect(accepts({ limitBy: { n: 0, by: ['period'] } })).toBe(false);
      expect(accepts({ limitBy: { n: 3, by: [] } })).toBe(false);
      expect(accepts({ other: { dimension: 'country', n: 5, measure: 'revenue', label: 'Rest' } })).toBe(true);
      // `other` buckets a local string dimension only.
      expect(accepts({ other: { dimension: 'customer.tier', n: 5, measure: 'revenue' } })).toBe(false);
      expect(accepts({ other: { dimension: 'amount', n: 5, measure: 'revenue' } })).toBe(false);
      // ...ranked by a base or derived measure, not a window or shift.
      expect(accepts({ other: { dimension: 'country', n: 5, measure: 'running' } })).toBe(false);
      expect(accepts({ other: { dimension: 'country', n: 5, measure: 'customer.customers' } })).toBe(false);
      expect(accepts({ other: { dimension: 'country', n: 5, measure: 'revenue', label: '' } })).toBe(false);
    });

    it('checks orderBy and having names against the call\'s own outputs', () => {
      const calculations = [{ name: 'vs', compare: { to: 'previousYear', measures: ['revenue'] } }, { name: 'r', rank: { measure: 'revenue' } }];
      expect(accepts({ calculations, orderBy: [{ field: 'r', direction: 'asc' }, { field: 'revenue_change', direction: 'desc' }] })).toBe(true);
      expect(accepts({ calculations, having: [{ measure: 'revenue_change_pct', operator: 'gt', value: 0.1 }] })).toBe(true);
      expect(issues({ calculations, orderBy: [{ field: 'vs', direction: 'asc' }] })).toContain('"path":["orderBy",0,"field"]');
      expect(issues({ having: [{ measure: 'r', operator: 'gt', value: 1 }] })).toContain('"path":["having",0,"measure"]');
    });

    it('leaves out time kinds, limitBy and other where nothing could use them', () => {
      const flat = JSON.stringify(buildCanonicalSemanticQuerySchemas({ flat: Flat }, ALL).queryDatasetJsonSchema);
      for (const kind of ['"shift"', '"window"', '"compare"', '"other"', '"fill"']) expect(flat).not.toContain(kind);
      for (const kind of ['"formula"', '"rank"', '"share"', '"filter"', '"limitBy"']) expect(flat).toContain(kind);
      const Empty = dataset('empty', { source: 'x', dimensions: {}, measures: { rows: measure.count() } });
      expect(JSON.stringify(buildCanonicalSemanticQuerySchemas({ empty: Empty }, ALL).queryDatasetJsonSchema)).not.toContain('"limitBy"');
      const NoBase = dataset('nobase', { source: 'x', dimensions: { a: dimension.number() }, measures: { latest: measure.argMax('a', 'a') } });
      expect(JSON.stringify(buildCanonicalSemanticQuerySchemas({ nobase: NoBase }, ALL).queryDatasetJsonSchema)).not.toContain('"filter"');
    });

    it('is absent while off', () => {
      const off = buildDatasetInputSchema(Orders, { ...ALL, calculations: false });
      expect(off.safeParse({ measures: ['revenue'], calculations: [] }).success).toBe(false);
      expect(off.safeParse({ measures: ['revenue'], orderBy: [{ field: 'x', direction: 'asc' }] }).success).toBe(false);
    });
  });

  it('compiles the same features from a hosted catalog', () => {
    const catalog = getDatasetCatalog(Orders);
    const hosted = buildDatasetInputSchema(catalog, ALL);
    expect(hosted.safeParse({
      measures: ['revenue'],
      filters: [{ or: [{ field: 'country', operator: 'eq', value: 'US' }, { field: 'createdAt', operator: 'inDateRange', value: 'last week' }] }],
      calculations: [{ name: 'p', share: { measure: 'revenue' } }],
      grain: 'week', fill: true, timeKey: 'shippedAt',
    }).success).toBe(true);
  });

  it('refuses to describe recursive or patterned features as protocol schemas', () => {
    expect(() => buildDatasetInputProtocolSchema(Orders, { filterGroups: true })).toThrow(/cannot describe filterGroups/);
    expect(() => buildMetricInputProtocolSchema(Orders, 'x', { relativeDates: true, calculations: true }))
      .toThrow(/cannot describe relativeDates, calculations/);
    expect(buildDatasetInputProtocolSchema(Orders, { fill: true })).toBeDefined();
  });
});
