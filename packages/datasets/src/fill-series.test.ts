import { describe, expect, it } from 'vitest';
import { dataset } from './dataset.js';
import { dimension } from './field.js';
import { measure } from './measure.js';
import { createDatasetClient } from './executor.js';
import { createInMemoryBackend } from './in-memory-backend.js';
import { datasetCacheKey, resolveProtocolCacheKeySettings } from './cache/protocol-cache-keys.js';
import { createQueryBuilder } from '../../clickhouse/src/index.js';

// RFC 0029 §3: a plain `by` query that returns every period of its range.
const Orders = dataset('orders', {
  source: 'orders',
  timeKey: 'createdAt',
  dimensions: {
    country: dimension.string(),
    createdAt: dimension.timestamp({ column: 'created_at' }),
  },
  measures: {
    orders: measure.count('id'),
    revenue: measure.sum('amount'),
  },
});

const client = createDatasetClient({
  queryBuilder: createQueryBuilder({ host: 'http://127.0.0.1:8123' }),
  now: () => new Date('2026-11-22T10:00:00Z'),
});
const january = { field: 'createdAt', operator: 'between', value: ['2026-01-01', '2026-01-31'] } as const;

describe('fill (RFC 0029)', () => {
  it('plans a filled query on the time-axis series, with counts coalesced to 0', () => {
    const compiled = client.compileDataset(Orders, {
      dimensions: ['country'], measures: ['orders', 'revenue'], by: 'day', fill: true, filters: [january],
    });
    expect(compiled.describe().plan).toBe('time');
    expect(compiled.sql).toContain('_hq_series');
    expect(compiled.sql).toContain('CROSS JOIN (SELECT DISTINCT');
    expect(compiled.sql).toMatch(/coalesce\(m0\._hq_m0, 0\) AS `orders`/);
    expect(compiled.sql).toMatch(/m1\._hq_m1 AS `revenue`/);
    expect(compiled.preflightStatements).toHaveLength(1);
  });

  it('fills every base measure when none is named', () => {
    const compiled = client.compileDataset(Orders, { by: 'month', fill: true, filters: [january] });
    expect(compiled.sql).toContain('AS `orders`');
    expect(compiled.sql).toContain('AS `revenue`');
  });

  it('takes its range from a top-level inDateRange', () => {
    const compiled = client.compileDataset(Orders, {
      measures: ['orders'], by: 'day', fill: true,
      filters: [{ field: 'createdAt', operator: 'inDateRange', value: 'last 7 days' }],
    });
    expect(compiled.parameters).toEqual(expect.arrayContaining(['2026-11-15', '2026-11-22']));
  });

  it('leaves an unfilled query on the aggregate plan, byte for byte', () => {
    const plain = client.compileDataset(Orders, { measures: ['orders'], by: 'day', filters: [january] });
    const unfilled = client.compileDataset(Orders, { measures: ['orders'], by: 'day', fill: false, filters: [january] });
    expect(plain.describe().plan).toBe('aggregate');
    expect(unfilled.sql).toBe(plain.sql);
  });

  it('refuses fill without by, without a bounded range, with having, or with a nested time comparison', () => {
    const errors = (query: Record<string, unknown>) => client.validate(Orders, { measures: ['orders'], ...query } as never).errors;
    expect(errors({ fill: true, filters: [january] })).toContain('"fill" needs a "by" grain: it fills the periods of the time series.');
    expect(errors({ fill: true, by: 'day' }))
      .toContain('Filled queries require exactly one bounded time range: between, or gt/gte with lt/lte, using ISO timestamps.');
    expect(errors({ fill: true, by: 'day', filters: [{ field: 'createdAt', operator: 'gte', value: '2026-01-01' }] }))
      .toHaveLength(1);
    expect(errors({ fill: true, by: 'day', filters: [january], having: [{ measure: 'orders', operator: 'gt', value: 1 }] }))
      .toContain('Having is not supported on filled queries.');
    expect(errors({ fill: true, by: 'day', filters: [january, { or: [{ field: 'createdAt', operator: 'lt', value: '2026-01-10' }, { field: 'country', operator: 'eq', value: 'US' }] }] }))
      .toContain('Filled queries need their time range as top-level filters: a time-axis comparison inside "or" or "not" cannot bound the series.');
    expect(errors({ fill: 'yes', by: 'day', filters: [january] })).toContain('Invalid fill: expected true or false.');
  });

  it('reports a malformed filter tree from validate() instead of throwing', () => {
    const errors = (filters: unknown[]) => client.validate(Orders, { measures: ['orders'], by: 'day', fill: true, filters } as never).errors;
    expect(errors([january, { and: [january], not: [] }])).toContain('A filter group has exactly one of "and", "or" or "not".');
    expect(errors([january, null])).toContain('Each filter must be an object: a comparison, or an and/or/not group.');
    let deep: unknown = january;
    for (let depth = 0; depth < 5000; depth++) deep = { and: [deep] };
    expect(errors([deep])).toContain('Filter groups may nest at most 32 deep.');
  });

  it('bounds the series by the effective row limit', () => {
    expect(client.validate(Orders, { measures: ['orders'], by: 'day', fill: true, filters: [january], limit: 10 }).errors)
      .toContain('Window series exceeds the effective result limit of 10 buckets.');
  });

  it('refuses fill on the deprecated backend path', async () => {
    const memory = createDatasetClient({ backend: createInMemoryBackend({ orders: [] }) });
    await expect(Promise.resolve().then(() => memory.execute(Orders, { measures: ['orders'], by: 'day', fill: true, filters: [january] })))
      .rejects.toThrow('"fill" requires the queryBuilder execution path.');
  });

  it('fills a dimension-only query, scanning the exact range', () => {
    const noon = [
      { field: 'createdAt', operator: 'gte', value: '2026-01-01T12:00:00' },
      { field: 'createdAt', operator: 'lt', value: '2026-01-03' },
    ] as const;
    const compiled = client.compileDataset(Orders, { dimensions: ['country'], measures: [], by: 'day', fill: true, filters: [...noon] });
    expect(compiled.sql).not.toMatch(/WHERE \)/);
    // A row before the noon start must not add a country to the series.
    expect(compiled.sql).toContain('_hq_scanned AS (SELECT * FROM _hq_source CROSS JOIN _hq_bounds WHERE (_hq_time >= _hq_lower AND _hq_time < _hq_upper))');
    const measured = client.compileDataset(Orders, { dimensions: ['country'], measures: ['orders'], by: 'day', fill: true, filters: [...noon] });
    expect(measured.sql).toContain('WHERE (_hq_time >= _hq_lower AND _hq_time < _hq_upper))');
  });

  it('counts an omitted measure list against maxMeasures as omitted', () => {
    const Limited = dataset('limited', {
      source: 'orders',
      timeKey: 'createdAt',
      dimensions: { createdAt: dimension.timestamp({ column: 'created_at' }) },
      measures: { orders: measure.count('id'), revenue: measure.sum('amount') },
      limits: { maxMeasures: 1 },
    });
    const compiled = client.compileDataset(Limited, { by: 'day', fill: true, filters: [january] });
    expect(compiled.describe().measures).toEqual(['orders', 'revenue']);
    expect(compiled.sql).toContain('AS `revenue`');
    expect(client.validate(Limited, { measures: ['orders', 'revenue'], by: 'day', fill: true, filters: [january] }).errors)
      .toContain('Too many measures: 2 (max 1)');
  });

  it('never shares a cache key with the unfilled query', () => {
    const settings = resolveProtocolCacheKeySettings({}, false);
    const key = (fill?: boolean) => datasetCacheKey(settings, Orders, { measures: ['orders'], by: 'day', filters: [january], limit: 10, ...(fill === undefined ? {} : { fill }) }, undefined, undefined);
    expect(key()).toEqual(expect.any(String));
    expect(key(false)).toBe(key());
    expect(key(true)).toBeUndefined();
  });
});
