import { describe, expect, it } from 'vitest';
import { dataset } from './dataset.js';
import { dimension } from './field.js';
import { measure } from './measure.js';
import { analyzeWindowTimeAxis, intervalBuckets } from './utils/window-time-axis.js';
import { createDatasetClient } from './executor.js';
import { createInMemoryBackend } from './in-memory-backend.js';
import { projectAgentSafeCatalog } from './agent-catalog.js';
import { getDatasetCatalog } from './catalog.js';
import { buildDatasetQuerySignature } from './cache/query-signature.js';
import { serializeSemanticContract } from './contract.js';
import { divide } from './formulas.js';

const Events = dataset('events', {
  source: 'events', timeKey: 'time', dimensions: { time: dimension.timestamp({ column: 'event_at' }), amount: dimension.number() },
  filters: { range: { field: 'time' } },
  measures: { revenue: measure.sum('amount'), rolling: measure.trailing('revenue', { amount: 7, unit: 'day' }), running: measure.cumulative('revenue') },
});
const filters = [{ field: 'range', operator: 'gte' as const, value: '2026-01-01' }, { field: 'range', operator: 'lt' as const, value: '2026-01-08' }];

describe('window time axes', () => {
  it.each([
    [60, 'minute', 'hour', 1], [1, 'hour', 'minute', 60], [1, 'day', 'hour', 24], [1, 'week', 'day', 7],
    [1, 'quarter', 'month', 3], [1, 'year', 'quarter', 4], [1, 'year', 'month', 12],
    [1, 'month', 'day', undefined], [1, 'day', 'week', undefined], [90, 'minute', 'hour', undefined],
  ] as const)('converts %s %s into %s buckets exactly', (amount, unit, grain, expected) => {
    expect(intervalBuckets(amount, unit, grain)).toBe(expected);
  });
  it('recognizes semantic filter aliases and excludes only the output time range', () => {
    const { axis, errors } = analyzeWindowTimeAxis(Events, { by: 'day', measures: ['rolling'], filters });
    expect(errors).toEqual([]);
    expect(axis).toMatchObject({ lower: '2026-01-01', upper: '2026-01-08', upperInclusive: false, bucketCount: 7, filters: [] });
  });
  it.each(['2026-02-30', '2026-01-01T24:00:00Z', 'junk'])('rejects an invalid timestamp %s', value => {
    expect(analyzeWindowTimeAxis(Events, { by: 'day', measures: ['rolling'], filters: [{ field: 'range', operator: 'between', value: [value, '2026-03-01'] }] }).errors).not.toEqual([]);
  });
  it('compares DateTime64 nanoseconds without truncating endpoints', () => {
    const query = { by: 'day' as const, measures: ['running'], filters: [{ field: 'range', operator: 'between' as const, value: ['2026-01-01T00:00:00.000000002Z', '2026-01-01T00:00:00.000000001Z'] }] };
    expect(analyzeWindowTimeAxis(Events, query).errors).toContain('Window measure time range must be non-empty and ordered.');
    query.filters[0].value.reverse();
    expect(analyzeWindowTimeAxis(Events, query).errors).toEqual([]);
  });
  it('rejects missing grains, unbounded or duplicate ranges, and oversized series', () => {
    for (const query of [
      { measures: ['rolling'], filters },
      { by: 'day' as const, measures: ['rolling'] },
      { by: 'day' as const, measures: ['rolling'], filters: [...filters, filters[0]] },
      { by: 'day' as const, measures: ['rolling'], filters, limit: 1 },
    ]) expect(analyzeWindowTimeAxis(Events, query).errors).not.toEqual([]);
  });
  it('rejects non-integral windows, incompatible to-date grains and more than 1000 contributions', () => {
    const ds = dataset('badAxes', { source: 'events', timeKey: 'time', dimensions: Events.dimensions, filters: Events.filters,
      measures: { revenue: measure.sum('amount'), month: measure.trailing('revenue', { amount: 1, unit: 'month' }), large: measure.trailing('revenue', { amount: 1001, unit: 'day' }), toMonth: measure.toDate('revenue', 'month') },
    });
    expect(analyzeWindowTimeAxis(ds, { by: 'day', measures: ['month', 'large'], filters }).errors).toHaveLength(2);
    expect(analyzeWindowTimeAxis(ds, { by: 'week', measures: ['toMonth'], filters }).errors.join(' ')).toContain('strictly coarser');
  });
  it('rejects the frozen backend path explicitly', () => {
    const client = createDatasetClient({ backend: createInMemoryBackend({ events: [] }) });
    expect(() => client.execute(Events, { by: 'day', measures: ['running'], filters })).toThrow('Window dataset measures require the queryBuilder execution path.');
  });
  it('propagates approximation and window parameters to catalogs and agents', () => {
    const ds = dataset('approximateWindows', { source: 'events', timeKey: 'time', dimensions: Events.dimensions, filters: Events.filters,
      measures: { approx: measure.approxCountDistinct('amount'), rolling: measure.trailing('approx', { amount: 7, unit: 'day' }), ratio: measure.derived({ uses: { rolling: 'rolling' }, formula: ({ rolling }) => divide(rolling, 2) }) },
    });
    const catalog = getDatasetCatalog(ds);
    expect(catalog.measures.rolling).toMatchObject({ approximate: true, kind: 'window', measure: 'approx', trailing: { amount: 7, unit: 'day' }, requiresTimeRange: true });
    expect(serializeSemanticContract({ ds }).datasets.ds.measures.rolling).toMatchObject({ kind: 'window', measure: 'approx', trailing: { amount: 7, unit: 'day' }, requiresTimeRange: true, approximate: true });
    expect(catalog.derivedMeasures?.ratio).toMatchObject({ approximate: true, requiresTimeRange: true });
    expect(projectAgentSafeCatalog({ ds }).datasets[0].measures.find(entry => entry.name === 'rolling')).toMatchObject({ approximate: true, kind: 'window', trailing: { amount: 7, unit: 'day' }, requiresTimeRange: true });
  });
  it('partitions cache entries when authored window parameters change', () => {
    const other = dataset('events', { source: 'events', timeKey: 'time', dimensions: Events.dimensions, filters: Events.filters, measures: { revenue: measure.sum('amount'), rolling: measure.trailing('revenue', { amount: 14, unit: 'day' }), running: measure.cumulative('revenue') } });
    const query = { by: 'day' as const, measures: ['rolling'], filters };
    expect(buildDatasetQuerySignature(Events, query)).not.toBe(buildDatasetQuerySignature(other, query));
    expect(buildDatasetQuerySignature(Events, { measures: ['revenue'] })).toBe(buildDatasetQuerySignature(other, { measures: ['revenue'] }));
  });

});
