import { describe, expect, it } from 'vitest';
import { dataset } from './dataset.js';
import { dimension } from './field.js';
import { measure } from './measure.js';
import { createDatasetClient } from './executor.js';
import { createInMemoryBackend } from './in-memory-backend.js';
import { resolveRelativeDateRange } from './utils/relative-date-range.js';
import { relativeDateFilterError, resolveRelativeDateFilters } from './utils/relative-date-filters.js';
import { createQueryBuilder } from '../../clickhouse/src/index.js';
import type { DatasetFilterNode } from './types.js';

// RFC 0029 §2: Sunday 2026-11-22, 10:00 UTC.
const NOW = new Date('2026-11-22T10:00:00Z');

describe('relative date ranges (RFC 0029)', () => {
  it.each([
    ['today', '2026-11-22', '2026-11-23'],
    ['yesterday', '2026-11-21', '2026-11-22'],
    // Weeks start on Sunday, the day the week grain truncates to.
    ['this week', '2026-11-22', '2026-11-29'],
    ['this month', '2026-11-01', '2026-12-01'],
    ['this quarter', '2026-10-01', '2027-01-01'],
    ['this year', '2026-01-01', '2027-01-01'],
    ['last day', '2026-11-21', '2026-11-22'],
    ['last week', '2026-11-15', '2026-11-22'],
    ['last month', '2026-10-01', '2026-11-01'],
    ['last quarter', '2026-07-01', '2026-10-01'],
    ['last year', '2025-01-01', '2026-01-01'],
    // The current period is excluded: seven whole days ending yesterday.
    ['last 7 days', '2026-11-15', '2026-11-22'],
    ['last 1 day', '2026-11-21', '2026-11-22'],
    ['last 30 days', '2026-10-23', '2026-11-22'],
    ['last 2 weeks', '2026-11-08', '2026-11-22'],
    ['last 3 months', '2026-08-01', '2026-11-01'],
    ['last 3 month', '2026-08-01', '2026-11-01'],
    ['last 2 quarters', '2026-04-01', '2026-10-01'],
    ['last 2 years', '2024-01-01', '2026-01-01'],
    ['month to date', '2026-11-01', '2026-11-23'],
    ['quarter to date', '2026-10-01', '2026-11-23'],
    ['year to date', '2026-01-01', '2026-11-23'],
    // Clamped to the earliest date ClickHouse stores.
    ['last 9999 years', '1900-01-01', '2026-01-01'],
  ])('resolves %s', (value, start, end) => {
    expect(resolveRelativeDateRange(value, NOW, 'UTC')).toEqual({ start, end });
  });

  it('reads today in the query zone', () => {
    // 10:00 UTC on the 22nd is already the 23rd in Auckland and still the 22nd in Honolulu.
    const late = new Date('2026-11-22T11:30:00Z');
    expect(resolveRelativeDateRange('today', NOW, 'Pacific/Auckland')).toEqual({ start: '2026-11-22', end: '2026-11-23' });
    expect(resolveRelativeDateRange('today', late, 'Pacific/Auckland')).toEqual({ start: '2026-11-23', end: '2026-11-24' });
    expect(resolveRelativeDateRange('today', new Date('2026-11-22T05:00:00Z'), 'Pacific/Honolulu'))
      .toEqual({ start: '2026-11-21', end: '2026-11-22' });
    // Monday the 23rd in Auckland starts a new week there.
    expect(resolveRelativeDateRange('last week', late, 'Pacific/Auckland')).toEqual({ start: '2026-11-15', end: '2026-11-22' });
  });

  it('crosses year boundaries and leap days', () => {
    const newYear = new Date('2027-01-01T00:30:00Z');
    expect(resolveRelativeDateRange('last month', newYear, 'UTC')).toEqual({ start: '2026-12-01', end: '2027-01-01' });
    expect(resolveRelativeDateRange('last quarter', newYear, 'UTC')).toEqual({ start: '2026-10-01', end: '2027-01-01' });
    expect(resolveRelativeDateRange('yesterday', new Date('2028-03-01T12:00:00Z'), 'UTC')).toEqual({ start: '2028-02-29', end: '2028-03-01' });
  });

  it.each(['last 0 days', 'Last 7 days', 'last 07 days', 'last 10000 days', 'this hour', 'week to date', ' today', 7])(
    'refuses %j',
    value => expect(resolveRelativeDateRange(value, NOW, 'UTC')).toBeUndefined(),
  );
});

const Orders = dataset('orders', {
  source: 'orders',
  timeKey: 'createdAt',
  timeKeys: ['shippedAt'],
  dimensions: {
    country: dimension.string(),
    createdAt: dimension.timestamp({ column: 'created_at' }),
    shippedAt: dimension.timestamp({ column: 'shipped_at' }),
    signupAt: dimension.timestamp({ column: 'signup_at' }),
    narrow: dimension.timestamp({ column: 'narrow_at' }),
  },
  measures: { orders: measure.count('id') },
  filters: {
    createdFilter: { __type: 'filter_definition', field: 'createdAt' },
    narrow: { __type: 'filter_definition', field: 'narrow', operators: ['gte'] },
  },
});

describe('inDateRange query filters (RFC 0029)', () => {
  const client = createDatasetClient({
    queryBuilder: createQueryBuilder({ host: 'http://127.0.0.1:8123' }),
    timezone: 'Europe/Berlin',
    now: () => NOW,
  });
  const compile = (filters: DatasetFilterNode[], extra: Record<string, unknown> = {}) => client.compileDataset(Orders, {
    measures: ['orders'], filters, ...extra,
  } as never);

  it('resolves to a half-open range on the time axis, read in the query zone', () => {
    const { sql, parameters } = compile([{ field: 'createdAt', operator: 'inDateRange', value: 'last 7 days' }]);
    expect(sql).toContain("toDateTime64(orders.created_at, 9, 'Europe/Berlin') >= ? AND toDateTime64(orders.created_at, 9, 'Europe/Berlin') < ?");
    expect(parameters).toEqual(['2026-11-15', '2026-11-22']);
  });

  it('accepts a filter alias, an alternate time key, and a range under or/not', () => {
    expect(compile([{ field: 'createdFilter', operator: 'inDateRange', value: 'today' }]).parameters)
      .toEqual(['2026-11-22', '2026-11-23']);
    expect(compile([{ field: 'shippedAt', operator: 'inDateRange', value: 'this month' }]).parameters)
      .toEqual(['2026-11-01', '2026-12-01']);
    const negated = compile([{ not: { field: 'createdAt', operator: 'inDateRange', value: 'this year' } }]);
    expect(negated.sql).toContain("(toDateTime64(orders.created_at, 9, 'Europe/Berlin') < ? OR toDateTime64(orders.created_at, 9, 'Europe/Berlin') >= ?)");
    expect(negated.parameters).toEqual(['2026-01-01', '2027-01-01']);
  });

  it('refuses a field that is not a time axis, a bad value, and a narrowed allowlist', () => {
    const errors = (filters: DatasetFilterNode[]) => client.validate(Orders, { measures: ['orders'], filters }).errors;
    expect(errors([{ field: 'signupAt', operator: 'inDateRange', value: 'today' }]))
      .toEqual(['Filter "signupAt" cannot use "inDateRange": it applies only to a time axis (createdAt, shippedAt).']);
    expect(errors([{ field: 'createdAt', operator: 'inDateRange', value: 'last fortnight' }]))
      .toEqual([expect.stringContaining('"last fortnight" is not a relative date range')]);
    expect(errors([{ field: 'country', operator: 'inDateRange', value: 'today' }])).toHaveLength(1);
  });

  it('reads the clock once per query, so the cache key moves with the calendar', () => {
    let now = NOW;
    const ticking = createDatasetClient({ queryBuilder: createQueryBuilder({ host: 'http://127.0.0.1:8123' }), now: () => now });
    const params = () => ticking.compileDataset(Orders, { measures: ['orders'], filters: [{ field: 'createdAt', operator: 'inDateRange', value: 'today' }] }).parameters;
    expect(params()).toEqual(['2026-11-22', '2026-11-23']);
    now = new Date('2026-11-23T00:00:01Z');
    expect(params()).toEqual(['2026-11-23', '2026-11-24']);
  });

  it('keeps top-level bounds flat for the deprecated backend plan', () => {
    const memory = createDatasetClient({ backend: createInMemoryBackend({ orders: [] }), now: () => NOW });
    const plan = memory.planDataset(Orders, {
      measures: ['orders'], filters: [{ field: 'createdAt', operator: 'inDateRange', value: 'last 7 days' }],
    }) as unknown as { filters: { operator: string; value: unknown }[] };
    expect(plan.filters.map(filter => [filter.operator, filter.value])).toEqual([['gte', '2026-11-15'], ['lt', '2026-11-22']]);
  });

  it('refuses inDateRange in measure filters and segments', () => {
    expect(() => dataset('bad', {
      source: 'orders',
      timeKey: 'createdAt',
      dimensions: { createdAt: dimension.timestamp() },
      measures: { recent: measure.count('id', { filters: [{ field: 'createdAt', operator: 'inDateRange', value: 'today' }] }) },
    })).toThrow(/inDateRange/);
    expect(() => dataset('bad', {
      source: 'orders',
      timeKey: 'createdAt',
      dimensions: { createdAt: dimension.timestamp() },
      measures: { orders: measure.count('id') },
      segments: { recent: { filters: [{ field: 'createdAt', operator: 'inDateRange', value: 'today' }] } },
    })).toThrow(/inDateRange/);
  });

  it('resolves ranges inside and/or/not groups and in metric queries', () => {
    const nested = compile([{ or: [
      { and: [{ field: 'createdAt', operator: 'inDateRange', value: 'yesterday' }, { field: 'country', operator: 'eq', value: 'US' }] },
      { not: { field: 'shippedAt', operator: 'inDateRange', value: 'today' } },
    ] }]);
    expect(nested.parameters).toEqual(['2026-11-21', '2026-11-22', 'US', '2026-11-22', '2026-11-23']);
    const metric = Orders.metric('orders', { measure: 'orders' });
    expect(client.toSQL(metric, { filters: [{ field: 'createdAt', operator: 'inDateRange', value: 'last month' }] }))
      .toContain("toDateTime64(orders.created_at, 9, 'Europe/Berlin') >= ?");
  });
});

describe('relative date filter rewriting', () => {
  const range = { field: 'createdAt', operator: 'inDateRange', value: 'today' } as const;

  it('leaves non-arrays, untouched lists and malformed groups as written', () => {
    expect(resolveRelativeDateFilters(Orders, undefined, NOW, 'UTC')).toBeUndefined();
    const plain = [{ field: 'country', operator: 'eq', value: 'US' }] as DatasetFilterNode[];
    expect(resolveRelativeDateFilters(Orders, plain, NOW, 'UTC')).toBe(plain);
    const malformed = { and: [range], or: [] } as unknown as DatasetFilterNode;
    const odd = { not: [] } as unknown as DatasetFilterNode;
    expect(resolveRelativeDateFilters(Orders, [range, malformed, odd], NOW, undefined)).toEqual([
      { field: 'createdAt', operator: 'gte', value: '2026-11-22' },
      { field: 'createdAt', operator: 'lt', value: '2026-11-23' },
      malformed,
      odd,
    ]);
  });

  it('explains a dataset with no time axis', () => {
    const Untimed = dataset('untimed', {
      source: 'untimed', dimensions: { day: dimension.timestamp() }, measures: { rows: measure.count('day') },
    });
    expect(relativeDateFilterError(Untimed, { field: 'day', operator: 'inDateRange', value: 'today' }))
      .toBe('Filter "day" cannot use "inDateRange": dataset "untimed" has no time axis.');
    expect(relativeDateFilterError(Orders, { field: 'customer.createdAt', operator: 'inDateRange', value: 'today' }))
      .toMatch(/applies only to a time axis/);
  });
});

