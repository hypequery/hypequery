import { describe, expect, it } from 'vitest';
import { createQueryBuilder } from '../../clickhouse/src/index.js';
import { createDatasetClient, dataset, dimension, divide, measure } from './index.js';
import { instantWallClock, parseTimestampInstant } from './utils/timestamp-instants.js';
import { createRenderingBuilderFactory } from './tests/support/sql-equality-harness.js';

/**
 * ISO 8601 instants (`Z` or an offset, the form `Date#toISOString` emits) are
 * not readable by ClickHouse as DateTime64 literals. They are rewritten to the
 * wall clock of the zone the column is compared in, so the `Z` form returns the
 * same rows as the naive form, as it already does in the Python planner.
 */

const Orders = dataset('orders', {
  source: 'orders',
  timeKey: 'createdAt',
  tenantKey: 'tenant_id',
  dimensions: {
    createdAt: dimension.timestamp({ column: 'created_at' }),
    shippedAt: dimension.timestamp({ column: 'shipped_at' }),
    status: dimension.string(),
    country: dimension.string(),
    amount: dimension.number(),
  },
  measures: {
    orderCount: measure.count('id'),
    revenue: measure.sum('amount'),
    running: measure.cumulative('revenue'),
    averageOrder: measure.derived({
      uses: { revenue: 'revenue', orderCount: 'orderCount' },
      formula: ({ revenue, orderCount }) => divide(revenue, orderCount),
    }),
  },
  // `status` is both a string dimension and a caller filter alias for the
  // timestamp key; segments name the dimension, caller filters the alias.
  filters: { status: { field: 'createdAt' }, createdAt: { field: 'createdAt' }, shippedAt: { field: 'shippedAt' }, country: { field: 'country' }, amount: { field: 'amount' } },
  segments: {
    sinceFebruary: { filters: [{ field: 'createdAt', operator: 'gte', value: '2026-02-01T00:00:00Z' }] },
    isoStatus: { filters: [{ field: 'status', operator: 'eq', value: '2026-02-01T00:00:00Z' }] },
  },
});

const context = { runtime: { tenant: 'acme' } };
const queryBuilder = createQueryBuilder({ host: 'http://localhost:8123' });
const utc = createDatasetClient({ queryBuilder });
const tokyo = createDatasetClient({ queryBuilder, timezone: 'Asia/Tokyo' });

function compile(client: typeof utc, query: Parameters<typeof utc.compileDataset>[1]) {
  const compiled = client.compileDataset(Orders, query, context);
  return { sql: compiled.sql, parameters: compiled.parameters };
}

function where(client: typeof utc, field: string, operator: string, value: unknown) {
  const { sql, parameters } = compile(client, { measures: ['orderCount'], filters: [{ field, operator, value }] } as never);
  return { predicate: sql.slice(sql.indexOf(' AND ') + 5), parameters: parameters.slice(1) };
}

describe('instant wall clocks', () => {
  it.each([
    ['2026-02-01T00:00:00Z', 'UTC', '2026-02-01 00:00:00'],
    ['2026-02-01T00:00:00.000Z', 'UTC', '2026-02-01 00:00:00'],
    ['2026-02-01T00:00:00.123456Z', 'UTC', '2026-02-01 00:00:00.123456'],
    ['2026-02-01T00:00:00.000000001Z', 'UTC', '2026-02-01 00:00:00.000000001'],
    ['2026-02-01 09:30:00+09:30', 'UTC', '2026-02-01 00:00:00'],
    ['2026-02-01T00:00:00Z', 'Asia/Tokyo', '2026-02-01 09:00:00'],
    ['2026-03-07T07:00:00Z', 'America/New_York', '2026-03-07 02:00:00'],
    ['2026-07-01T00:00:00Z', 'America/New_York', '2026-06-30 20:00:00'],
    ['1969-12-31T23:59:58.5Z', 'UTC', '1969-12-31 23:59:58.5'],
  ])('reads %s in %s as %s', (value, timezone, expected) => {
    expect(instantWallClock(parseTimestampInstant(value)!, timezone)).toBe(expected);
  });

  it.each(['2026-02-01T00:00:00', '2026-02-01 00:00:00', '2026-02-01', '2026-02-01T00:00:00.5', '2026-02%', 'junk', 7, null])(
    'leaves the offset-free value %s to the engine', value => {
      expect(parseTimestampInstant(value)).toBeUndefined();
    },
  );
});

describe('timestamp filter binding', () => {
  it('binds the Z form exactly as the naive space-separated form', () => {
    const instant = compile(utc, { measures: ['orderCount'], filters: [{ field: 'createdAt', operator: 'gte', value: '2026-02-01T00:00:00Z' }] });
    const naive = compile(utc, { measures: ['orderCount'], filters: [{ field: 'createdAt', operator: 'gte', value: '2026-02-01 00:00:00' }] });
    expect(instant).toEqual(naive);
    expect(instant.sql).toContain("toDateTime64(created_at, 9, 'UTC') >= ?");
    expect(instant.parameters).toEqual(['acme', '2026-02-01 00:00:00']);
  });

  it.each([
    ['2026-02-01T00:00:00Z', '2026-02-01 00:00:00'],
    ['2026-02-01T00:00:00.000Z', '2026-02-01 00:00:00'],
    ['2026-02-01T00:00:00.250Z', '2026-02-01 00:00:00.25'],
    ['2026-02-01T09:00:00+09:00', '2026-02-01 00:00:00'],
  ])('rewrites the instant %s to %s on the time key', (value, bound) => {
    expect(where(utc, 'createdAt', 'gte', value)).toEqual({
      predicate: "toDateTime64(created_at, 9, 'UTC') >= ?",
      parameters: [bound],
    });
  });

  it.each(['2026-02-01T00:00:00', '2026-02-01 00:00:00', '2026-02-01', '2026-02-01T00:00:00.5'])(
    'binds the offset-free form %s unchanged in the query zone', value => {
      expect(where(utc, 'createdAt', 'gte', value)).toEqual({
        predicate: "toDateTime64(created_at, 9, 'UTC') >= ?",
        parameters: [value],
      });
      expect(where(tokyo, 'createdAt', 'gte', value)).toEqual({
        predicate: "toDateTime64(created_at, 9, 'Asia/Tokyo') >= ?",
        parameters: [value],
      });
    },
  );

  it('compares an instant in UTC whatever the query zone', () => {
    expect(where(tokyo, 'createdAt', 'gte', '2026-02-01T00:00:00Z')).toEqual({
      predicate: "toDateTime64(created_at, 9, 'UTC') >= ?",
      parameters: ['2026-02-01 00:00:00'],
    });
    expect(where(tokyo, 'createdAt', 'in', ['2026-02-01T00:00:00Z', '2026-02-02T00:00:00.5Z'])).toEqual({
      predicate: "toDateTime64(created_at, 9, 'UTC') IN (?, ?)",
      parameters: ['2026-02-01 00:00:00', '2026-02-02 00:00:00.5'],
    });
  });

  it('keeps an instant bound absolute when a range mixes it with a local bound', () => {
    expect(where(tokyo, 'createdAt', 'between', ['2026-02-01', '2026-02-01T00:00:00Z'])).toEqual({
      predicate: "toDateTime64(created_at, 9, 'Asia/Tokyo') >= ? AND toDateTime64(created_at, 9, 'UTC') <= ?",
      parameters: ['2026-02-01', '2026-02-01 00:00:00'],
    });
    expect(where(tokyo, 'createdAt', 'between', ['2026-02-01T00:00:00Z', '2026-03-01'])).toEqual({
      predicate: "toDateTime64(created_at, 9, 'UTC') >= ? AND toDateTime64(created_at, 9, 'Asia/Tokyo') <= ?",
      parameters: ['2026-02-01 00:00:00', '2026-03-01'],
    });
    // The repeated autumn hour: instants an hour apart must not bind alike.
    const newYork = createDatasetClient({ queryBuilder, timezone: 'America/New_York' });
    const early = where(newYork, 'createdAt', 'between', ['2026-11-01', '2026-11-01T05:30:00Z']);
    const late = where(newYork, 'createdAt', 'between', ['2026-11-01', '2026-11-01T06:30:00Z']);
    expect(early.parameters).toEqual(['2026-11-01', '2026-11-01 05:30:00']);
    expect(late.parameters).toEqual(['2026-11-01', '2026-11-01 06:30:00']);
    expect(early.predicate).toBe(late.predicate);
  });

  it('splits a mixed exclusion list and reads a mixed in list at the query zone', () => {
    expect(where(tokyo, 'createdAt', 'notIn', ['2026-02-01', '2026-02-01T00:00:00Z'])).toEqual({
      predicate: "toDateTime64(created_at, 9, 'Asia/Tokyo') NOT IN (?) AND toDateTime64(created_at, 9, 'UTC') NOT IN (?)",
      parameters: ['2026-02-01', '2026-02-01 00:00:00'],
    });
    expect(where(tokyo, 'createdAt', 'in', ['2026-02-01', '2026-02-01T00:00:00Z'])).toEqual({
      predicate: "toDateTime64(created_at, 9, 'Asia/Tokyo') IN (?, ?)",
      parameters: ['2026-02-01', '2026-02-01 09:00:00'],
    });
  });

  it('converts a non-time-key timestamp column only when its value is an instant', () => {
    expect(where(tokyo, 'shippedAt', 'lt', '2026-02-01')).toEqual({ predicate: 'shipped_at < ?', parameters: ['2026-02-01'] });
    expect(where(tokyo, 'shippedAt', 'lt', '2026-02-01T00:00:00Z')).toEqual({
      predicate: "toDateTime64(shipped_at, 9, 'UTC') < ?",
      parameters: ['2026-02-01 00:00:00'],
    });
  });

  it('never rewrites a string value or a like pattern that merely looks like an instant', () => {
    expect(where(utc, 'country', 'eq', '2026-02-01T00:00:00Z')).toEqual({ predicate: 'country = ?', parameters: ['2026-02-01T00:00:00Z'] });
    expect(where(utc, 'createdAt', 'like', '2026-02-01T00:00:00Z')).toEqual({
      predicate: "toDateTime64(created_at, 9, 'UTC') LIKE ?",
      parameters: ['2026-02-01T00:00:00Z'],
    });
  });

  it('keeps validation accepting every ISO 8601 form', () => {
    for (const value of ['2026-02-01T00:00:00Z', '2026-02-01T00:00:00.000Z', '2026-02-01T00:00:00', '2026-02-01 00:00:00', '2026-02-01']) {
      expect(utc.validate(Orders, { measures: ['orderCount'], filters: [{ field: 'createdAt', operator: 'gte', value }] }, context).valid).toBe(true);
    }
  });

  it('rewrites instants on the metric, derived, time-measure and segment paths', () => {
    const rendering = createDatasetClient({ queryBuilder: createRenderingBuilderFactory(), timezone: 'Asia/Tokyo' });
    const filters = [{ field: 'createdAt' as const, operator: 'gte' as const, value: '2026-02-01T00:00:00Z' }];
    const bound = "toDateTime64(created_at, 9, 'UTC') >= '2026-02-01 00:00:00'";

    expect(rendering.toSQL(Orders.metric('orderCount', { measure: 'orderCount' }), { filters }, context)).toContain(bound);
    expect(rendering.toSQL(Orders, { measures: ['averageOrder'], filters }, context)).toContain(bound);
    expect(rendering.toSQL(Orders, { measures: ['orderCount'], segments: ['sinceFebruary'] }, context)).toContain(bound);
    // A segment names the string dimension, not the alias that shadows it.
    expect(rendering.toSQL(Orders, { measures: ['orderCount'], segments: ['isoStatus'] }, context))
      .toContain("status = '2026-02-01T00:00:00Z'");
    expect(rendering.toSQL(Orders, { measures: ['orderCount'], filters: [{ field: 'status', operator: 'gte', value: '2026-02-01T00:00:00Z' }] }, context))
      .toContain(bound);

    const running = rendering.toSQL(Orders, {
      measures: ['running'], by: 'day',
      filters: [
        { field: 'createdAt', operator: 'between', value: ['2026-02-01', '2026-02-28'] },
        { field: 'shippedAt', operator: 'lt', value: '2026-02-15T00:00:00Z' },
      ],
    }, context);
    expect(running).toContain("toDateTime64(shipped_at, 9, 'UTC') < '2026-02-15 00:00:00'");
  });
});
