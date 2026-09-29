import { describe, expect, it } from 'vitest';
import { dataset } from './dataset.js';
import { dimension } from './field.js';
import { divide, nullIfZero } from './formulas.js';
import { measure } from './measure.js';
import { createDatasetClient } from './executor.js';
import { getDatasetCatalog } from './catalog.js';
import { projectAgentSafeCatalog } from './agent-catalog.js';
import { serializeSemanticContract } from './contract.js';
import { buildProtocolDeploymentContract } from './protocol-deployment-adapter.js';
import { createInMemoryBackend } from './in-memory-backend.js';
import { createRenderingBuilderFactory } from './tests/support/sql-equality-harness.js';
import { buildDatasetQuerySignature } from './cache/query-signature.js';
import type { MeasureTimeInterval } from './types.js';

const Events = dataset('events', { source: 'events', timeKey: 'time', dimensions: { time: dimension.timestamp({ column: 'event_at' }), value: dimension.number() },
  measures: { revenue: measure.sum('value'), prior: measure.shift('revenue', { amount: 1, unit: 'year' }), ratio: measure.derived({ uses: { revenue: 'revenue', prior: 'prior' }, formula: ({ revenue, prior }) => divide(revenue, nullIfZero(prior)) }) },
});
const client = createDatasetClient({ queryBuilder: createRenderingBuilderFactory() });
const filters = [{ field: 'time', operator: 'between' as const, value: ['2026-01-01', '2026-04-01'] }];

function withInterval(interval: MeasureTimeInterval) {
  return dataset('events', { source: 'events', timeKey: 'time', dimensions: Events.dimensions, measures: { revenue: measure.sum('value'), prior: measure.shift('revenue', interval) } });
}

describe('shift measures', () => {
  it('keeps shifts in measures, snapshots the interval, and keeps defaults base-only', () => {
    const interval: MeasureTimeInterval = { amount: 1, unit: 'year' };
    const definition = measure.shift('revenue', interval, { label: 'Prior revenue', currency: 'EUR' });
    expect(definition).toMatchObject({ __type: 'shift_measure_definition', measure: 'revenue', interval: { amount: 1, unit: 'year' }, label: 'Prior revenue', currency: 'EUR' });
    Object.assign(interval, { amount: 2 });
    expect(definition.interval.amount).toBe(1);
    expect(Object.keys(Events.measures)).toEqual(['revenue', 'prior', 'ratio']);
    expect('shiftMeasures' in Events).toBe(false);
    expect(client.toSQL(Events)).toBe('SELECT SUM(value) AS revenue FROM events');
    // @ts-expect-error Standalone metrics remain base-only.
    expect(() => Events.metric('invalid', { measure: 'prior' })).toThrow(/must be a base measure/);
  });
  it.each([0, -1, 1.5, Infinity, Number.MAX_SAFE_INTEGER + 1])('rejects invalid interval amount %s', amount => {
    expect(() => withInterval({ amount, unit: 'day' })).toThrow(/positive safe integer/);
  });
  it('rejects an unsupported interval unit', () => {
    // @ts-expect-error Exercise JavaScript runtime validation.
    expect(() => withInterval({ amount: 1, unit: 'fortnight' })).toThrow(/supported unit/);
  });
  it('requires a time key and a base measure from the same dataset', () => {
    expect(() => dataset('missingTime', { source: 'events', dimensions: Events.dimensions, measures: { revenue: measure.sum('value'), prior: measure.shift('revenue', { amount: 1, unit: 'year' }) } })).toThrow(/requires a timeKey/);
    for (const name of ['missing', 'prior', 'ratio', 'customer.revenue']) {
      expect(() => dataset('invalidInput', { source: 'events', timeKey: 'time', dimensions: Events.dimensions, measures: { ...Events.measures, invalid: measure.shift(name, { amount: 1, unit: 'year' }) } })).toThrow(/must wrap a base measure/);
    }
    expect(() => dataset('windowInput', { source: 'events', timeKey: 'time', dimensions: Events.dimensions, measures: { revenue: measure.sum('value'), rolling: measure.cumulative('revenue'), invalid: measure.shift('rolling', { amount: 1, unit: 'year' }) } })).toThrow(/must wrap a base measure/);
  });
  it('requires a supported grain and a bounded range, including when selected through a formula', () => {
    expect(client.validate(Events, { measures: ['prior'], filters }).valid).toBe(false);
    expect(client.validate(Events, { by: 'month', measures: ['ratio'] }).errors.join(' ')).toContain('bounded time range');
    expect(client.validate(Events, { by: 'month', measures: ['ratio'], filters }).valid).toBe(true);
    expect(client.validate(Events, { by: 'day', measures: ['prior'], filters }).valid).toBe(true);
  });
  it.each(['minute', 'hour', 'day', 'week', 'month', 'quarter', 'year'] as const)('allows a year shift at %s grain', by => {
    expect(client.validate(Events, { by, measures: ['prior'], filters }).valid).toBe(true);
  });
  it('does not apply the rolling fanout limit to large shifts', () => {
    expect(client.validate(withInterval({ amount: 1001, unit: 'day' }), { by: 'day', measures: ['prior'], filters }).valid).toBe(true);
  });
  it('rejects relationship traversal, the frozen backend, and contract 2 publishing', () => {
    expect(client.validate(Events, { by: 'month', measures: ['customer.prior'], filters }).valid).toBe(false);
    const backend = createDatasetClient({ backend: createInMemoryBackend({ events: [] }) });
    expect(() => backend.execute(Events, { by: 'month', measures: ['prior'], filters })).toThrow(/queryBuilder execution path/);
    expect(() => buildProtocolDeploymentContract([Events])).toThrow(/shift measures.*need deployment contract 3/);
  });
  it('exposes kind, interval, approximation and range requirements in catalogs and agents', () => {
    const ds = dataset('estimated', { source: 'events', timeKey: 'time', dimensions: Events.dimensions,
      measures: { users: measure.approxCountDistinct('value'), prior: measure.shift('users', { amount: 1, unit: 'month' }, { label: 'Prior users' }), ratio: measure.derived({ uses: { prior: 'prior' }, formula: ({ prior }) => divide(prior, 2) }) },
    });
    const expected = { kind: 'shift', measure: 'users', interval: { amount: 1, unit: 'month' }, approximate: true, requiresTimeRange: true, label: 'Prior users' };
    const catalog = getDatasetCatalog(ds);
    expect(catalog.measures.prior).toMatchObject(expected);
    expect(catalog.derivedMeasures?.ratio).toMatchObject({ approximate: true, requiresTimeRange: true });
    expect(projectAgentSafeCatalog({ ds }).datasets[0].measures.find(item => item.name === 'prior')).toMatchObject(expected);
    expect(serializeSemanticContract({ ds }).datasets.ds.measures.prior).toMatchObject(expected);
  });

  it('exposes grain intersections for shifts and dependent formulas', () => {
    const ds = dataset('grainRequirements', { source: 'events', timeKey: 'time', dimensions: Events.dimensions,
      timeGrains: ['day', 'month', 'quarter'],
      measures: { ...Events.measures, rolling: measure.trailing('revenue', { amount: 2, unit: 'month' }),
        difference: measure.derived({ uses: { rolling: 'rolling', prior: 'prior' }, formula: ({ rolling, prior }) => divide(rolling, prior) }) },
    });
    const catalog = getDatasetCatalog(ds);
    expect(catalog.measures.prior.supportedGrains).toEqual(['day', 'month', 'quarter']);
    expect(catalog.derivedMeasures?.difference.supportedGrains).toEqual(['month']);
    expect(projectAgentSafeCatalog({ ds }).datasets[0].measures.find(item => item.name === 'difference')?.supportedGrains).toEqual(['month']);
    expect(serializeSemanticContract({ ds }).datasets.ds.measures.prior.supportedGrains).toEqual(['day', 'month', 'quarter']);
  });

  it('partitions cache entries by interval, aggregation and formula while preserving ordinary keys', () => {
    const one = withInterval({ amount: 1, unit: 'year' });
    const two = withInterval({ amount: 2, unit: 'year' });
    const query = { by: 'month' as const, measures: ['prior'], filters };
    expect(buildDatasetQuerySignature(one, query)).not.toBe(buildDatasetQuerySignature(two, query));
    const maximum = dataset('events', { source: 'events', timeKey: 'time', dimensions: Events.dimensions,
      measures: { revenue: measure.max('value'), prior: one.measures.prior },
    });
    expect(buildDatasetQuerySignature(one, query)).not.toBe(buildDatasetQuerySignature(maximum, query));
    const changedFormula = dataset('events', { source: 'events', timeKey: 'time', dimensions: Events.dimensions,
      measures: { ...Events.measures, ratio: measure.derived({ uses: { revenue: 'revenue', prior: 'prior' }, formula: ({ revenue, prior }) => divide(prior, nullIfZero(revenue)) }) },
    });
    const formulaQuery = { ...query, measures: ['ratio'] };
    expect(buildDatasetQuerySignature(Events, formulaQuery)).not.toBe(buildDatasetQuerySignature(changedFormula, formulaQuery));
    expect(buildDatasetQuerySignature(one, { measures: ['revenue'] })).toBe(buildDatasetQuerySignature(two, { measures: ['revenue'] }));
  });
});
