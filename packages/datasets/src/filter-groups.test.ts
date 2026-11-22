import { describe, expect, it } from 'vitest';
import { dataset } from './dataset.js';
import { dimension } from './field.js';
import { measure } from './measure.js';
import { createDatasetClient } from './executor.js';
import { createInMemoryBackend } from './in-memory-backend.js';
import { createRenderingBuilderFactory } from './tests/support/sql-equality-harness.js';
import { createQueryBuilder } from '../../clickhouse/src/index.js';
import type { DatasetFilterNode, DatasetQueryFor } from './types.js';
import { datasetCacheKey, resolveProtocolCacheKeySettings } from './cache/protocol-cache-keys.js';

// RFC 0029: caller filters nest `and` / `or` / `not` groups.
const Orders = dataset('orders', {
  source: 'orders',
  timeKey: 'createdAt',
  dimensions: {
    country: dimension.string(),
    status: dimension.string(),
    email: dimension.string(),
    amount: dimension.number(),
    region: dimension.string(),
    createdAt: dimension.timestamp({ column: 'created_at' }),
  },
  measures: {
    orders: measure.count('id'),
    revenue: measure.sum('amount'),
    trailing: measure.trailing('revenue', { amount: 7, unit: 'day' }),
  },
  filters: {
    region: { __type: 'filter_definition', field: 'region', operators: ['eq'] },
  },
  limits: { maxFilters: 4 },
});

const client = createDatasetClient({ queryBuilder: createQueryBuilder({ host: 'http://127.0.0.1:8123' }) });
const sql = (filters: DatasetFilterNode[]) => client.toSQL(Orders, { measures: ['orders'], filters });
const where = (text: string) => text.slice(text.indexOf('WHERE')).replace(/ LIMIT .*$/s, '').trim();

describe('filter groups (RFC 0029)', () => {
  it('keeps a flat list as an AND of comparisons', () => {
    expect(where(sql([
      { field: 'country', operator: 'eq', value: 'US' },
      { field: 'status', operator: 'neq', value: 'refunded' },
    ]))).toBe("WHERE orders.country = ? AND orders.status != ?");
  });

  it('renders an or group in parentheses beside top-level comparisons', () => {
    expect(where(sql([
      { or: [
        { field: 'country', operator: 'eq', value: 'US' },
        { field: 'country', operator: 'eq', value: 'CA' },
      ] },
      { field: 'status', operator: 'neq', value: 'refunded' },
    ]))).toBe("WHERE (orders.country = ? OR orders.country = ?) AND orders.status != ?");
  });

  it('nests and inside or', () => {
    expect(where(sql([
      { or: [
        { and: [
          { field: 'country', operator: 'eq', value: 'US' },
          { field: 'amount', operator: 'gt', value: 100 },
        ] },
        { field: 'country', operator: 'eq', value: 'CA' },
      ] },
    ]))).toBe("WHERE ((orders.country = ? AND orders.amount > ?) OR orders.country = ?)");
  });

  it('pushes not down to the leaves', () => {
    expect(where(sql([{ not: { field: 'status', operator: 'eq', value: 'refunded' } }])))
      .toBe("WHERE orders.status != ?");
    expect(where(sql([{ not: { field: 'status', operator: 'in', value: ['a', 'b'] } }])))
      .toBe("WHERE orders.status NOT IN (?, ?)");
    expect(where(sql([{ not: { field: 'email', operator: 'like', value: '%@test.%' } }])))
      .toBe("WHERE orders.email NOT LIKE ?");
    expect(where(sql([{ not: { field: 'amount', operator: 'between', value: [10, 20] } }])))
      .toBe('WHERE (orders.amount < ? OR orders.amount > ?)');
    expect(where(sql([{ not: { not: { field: 'amount', operator: 'gte', value: 5 } } }])))
      .toBe('WHERE orders.amount >= ?');
  });

  it('applies De Morgan to a negated group', () => {
    expect(where(sql([{ not: { and: [
      { field: 'country', operator: 'eq', value: 'US' },
      { field: 'amount', operator: 'lt', value: 10 },
    ] } }]))).toBe("WHERE (orders.country != ? OR orders.amount >= ?)");
    expect(where(sql([{ not: { or: [
      { field: 'country', operator: 'eq', value: 'US' },
      { field: 'amount', operator: 'between', value: [1, 2] },
    ] } }]))).toBe('WHERE orders.country != ? AND (orders.amount < ? OR orders.amount > ?)');
  });

  it('treats a one-item group as its item', () => {
    expect(where(sql([{ or: [{ field: 'country', operator: 'eq', value: 'US' }] }])))
      .toBe("WHERE orders.country = ?");
  });

  it('reads a time-key comparison inside a group in the query zone', () => {
    const text = client.toSQL(Orders, {
      measures: ['orders'],
      timezone: 'Europe/Berlin',
      filters: [{ or: [
        { field: 'createdAt', operator: 'lt', value: '2026-01-01' },
        { field: 'country', operator: 'eq', value: 'US' },
      ] }],
    });
    expect(where(text)).toBe("WHERE (toDateTime64(orders.created_at, 9, 'Europe/Berlin') < ? OR orders.country = ?)");
  });

  it('checks each comparison against the allowlist with its effective operator', async () => {
    const run = (filters: DatasetFilterNode[]) => client.validate(Orders, { measures: ['orders'], filters });
    expect(run([{ or: [
      { field: 'region', operator: 'eq', value: 'emea' },
      { field: 'region', operator: 'eq', value: 'apac' },
    ] }]).valid).toBe(true);
    expect(run([{ not: { field: 'region', operator: 'eq', value: 'emea' } }]).errors)
      .toEqual([expect.stringContaining('does not allow operator "neq" (the negation of "eq")')]);
    expect(run([{ not: { or: [{ field: 'region', operator: 'eq', value: 'emea' }, { field: 'country', operator: 'eq', value: 'US' }] } }]).valid)
      .toBe(false);
  });

  it('counts comparisons, not groups, against maxFilters', () => {
    const leaf = { field: 'country', operator: 'eq', value: 'US' } as const;
    expect(client.validate(Orders, { measures: ['orders'], filters: [{ or: [leaf, leaf] }, { and: [leaf, leaf] }] }).valid).toBe(true);
    expect(client.validate(Orders, { measures: ['orders'], filters: [{ or: [leaf, leaf, leaf] }, { and: [leaf, leaf] }] }).errors)
      .toContain('Too many filters: 5 (max 4)');
  });

  it('refuses malformed groups and unknown fields inside them', () => {
    const run = (filters: unknown) => client.validate(Orders, { measures: ['orders'], filters: filters as never });
    expect(run([{ or: [] }]).errors).toEqual(['An "or" group needs a non-empty array of filters.']);
    expect(run([{ and: [{ field: 'country', operator: 'eq', value: 'US' }], or: [] }]).errors)
      .toEqual(['A filter group has exactly one of "and", "or" or "not".']);
    expect(run([{ not: [] }]).errors).toEqual(['A "not" group takes one filter, not an array.']);
    expect(run([{ or: [{ field: 'nope', operator: 'eq', value: 1 }, { field: 'country', operator: 'eq', value: 'US' }] }]).errors)
      .toEqual([expect.stringContaining('Unknown filter fields: nope')]);
  });

  it('refuses a time-axis comparison inside or/not on a window query', () => {
    const result = client.validate(Orders, {
      measures: ['trailing'],
      by: 'day',
      filters: [
        { field: 'createdAt', operator: 'between', value: ['2026-01-01', '2026-01-31'] },
        { or: [{ field: 'createdAt', operator: 'lt', value: '2026-01-15' }, { field: 'country', operator: 'eq', value: 'US' }] },
      ],
    });
    expect(result.errors).toContain('Window measures need their time range as top-level filters: a time-axis comparison inside "or" or "not" cannot bound the series.');
  });

  it('accepts a range inside a top-level and on a window query, and applies the rest to rows', () => {
    const text = client.toSQL(Orders, {
      measures: ['trailing'],
      by: 'day',
      filters: [
        { and: [
          { field: 'createdAt', operator: 'gte', value: '2026-01-01' },
          { field: 'createdAt', operator: 'lt', value: '2026-02-01' },
        ] },
        { or: [{ field: 'country', operator: 'eq', value: 'US' }, { field: 'country', operator: 'eq', value: 'CA' }] },
      ],
    });
    expect(text).toContain('WHERE (orders.country = ? OR orders.country = ?)');
  });

  it('keys the cache by the tree, so or and and never share an entry', () => {
    const settings = resolveProtocolCacheKeySettings({}, false);
    const a = { field: 'country', operator: 'eq', value: 'US' } as const;
    const b = { field: 'country', operator: 'eq', value: 'CA' } as const;
    const key = (filters: DatasetFilterNode[]) => datasetCacheKey(settings, Orders, { measures: ['orders'], filters, limit: 10 }, undefined, undefined);
    expect(key([{ or: [a, b] }])).toEqual(expect.any(String));
    expect(key([{ or: [a, b] }])).not.toBe(key([{ and: [a, b] }]));
    // A top-level and is the flat list.
    expect(key([{ and: [a, b] }])).not.toBe(key([{ not: { or: [a, b] } }]));
  });

  it('refuses groups on a builder without group methods', () => {
    const flat = createDatasetClient({ queryBuilder: createRenderingBuilderFactory() });
    expect(() => flat.toSQL(Orders, {
      measures: ['orders'],
      filters: [{ or: [{ field: 'country', operator: 'eq', value: 'US' }, { field: 'country', operator: 'eq', value: 'CA' }] }],
    })).toThrow(/need a query builder with whereGroup, orWhere and orWhereGroup/);
  });

  it('refuses groups on the deprecated backend path rather than flattening them', async () => {
    const backend = createDatasetClient({ backend: createInMemoryBackend({ orders: [] }) });
    await expect(Promise.resolve().then(() => backend.execute(Orders, {
      measures: ['orders'],
      filters: [{ or: [{ field: 'country', operator: 'eq', value: 'US' }, { field: 'country', operator: 'eq', value: 'CA' }] }],
    }))).rejects.toThrow('Filter groups (and/or/not) require the queryBuilder execution path.');
  });

  it('types groups over the dataset filter names', () => {
    const query: DatasetQueryFor<typeof Orders> = {
      measures: ['orders'],
      filters: [{ or: [{ field: 'country', operator: 'eq', value: 'US' }, { not: { field: 'region', operator: 'eq', value: 'x' } }] }],
    };
    // @ts-expect-error unknown filter field inside a group
    const bad: DatasetQueryFor<typeof Orders> = { filters: [{ or: [{ field: 'nope', operator: 'eq', value: 1 }] }] };
    expect([query, bad]).toHaveLength(2);
  });
});
