import { describe, expect, it } from 'vitest';
import { dataset } from './dataset.js';
import { createDatasetClient } from './executor.js';
import { dimension } from './field.js';
import { measure } from './measure.js';
import { divide, nullIfZero } from './formulas.js';
import { buildProtocolDeploymentContract } from './protocol-deployment-adapter.js';
import { createRenderingBuilderFactory } from './tests/support/sql-equality-harness.js';
import { getDatasetCatalog } from './catalog.js';
import { projectAgentSafeCatalog } from './agent-catalog.js';
import { buildCanonicalSemanticQuerySchemas, buildDatasetInputSchema } from './semantic-query-schema.js';
import { createInMemoryBackend } from './in-memory-backend.js';

function orders(measures: Record<string, ReturnType<typeof measure.sum> | ReturnType<typeof measure.cumulative>>) {
  return dataset('orders', {
    source: 'orders',
    timeKey: 'createdAt',
    dimensions: { createdAt: dimension.timestamp(), amount: dimension.number() },
    measures,
  });
}

describe('RFC 0015 window measure authoring', () => {
  it.each([false, true])('includes executable windows and window-dependent formulas in catalogs and schemas (base formula: %s)', (includeBaseFormula) => {
    const ds = dataset('orders', {
      source: 'orders', timeKey: 'createdAt',
      dimensions: { createdAt: dimension.timestamp(), amount: dimension.number() },
      measures: {
        revenue: measure.sum('amount'),
        runningRevenue: measure.cumulative('revenue'),
        growth: measure.derived({
          uses: { running: 'runningRevenue', current: 'revenue' },
          formula: ({ running, current }) => divide(current, nullIfZero(running)),
        }),
        ...(includeBaseFormula ? {
          revenueRatio: measure.derived({
            uses: { current: 'revenue' },
            formula: ({ current }) => divide(current, nullIfZero(current)),
          }),
        } : {}),
      },
    });
    const catalog = getDatasetCatalog(ds);
    const expectedDerived = includeBaseFormula ? ['growth', 'revenueRatio'] : ['growth'];
    expect(Object.keys(catalog.derivedMeasures ?? {})).toEqual(expectedDerived);
    expect(catalog.orderableFields).toContain('growth');
    expect(catalog.orderableFields).toContain('runningRevenue');
    expect(catalog.measures.runningRevenue).toMatchObject({ kind: 'window', measure: 'revenue', cumulative: true, requiresTimeRange: true });
    expect(projectAgentSafeCatalog({ orders: ds }).datasets[0]!.measures.map(item => item.name))
      .toEqual([...expectedDerived, 'revenue', 'runningRevenue'].sort());

    const schema = buildDatasetInputSchema(ds);
    const canonicalSchema = buildCanonicalSemanticQuerySchemas({ orders: ds }).queryDataset;
    for (const name of ['runningRevenue', 'growth']) {
      expect(schema.safeParse({ measures: [name], by: 'day' }).success).toBe(true);
      expect(schema.safeParse({ measures: ['revenue'], orderBy: [{ field: name, direction: 'asc' }] }).success).toBe(true);
      expect(canonicalSchema.safeParse({ dataset: 'orders', measures: [name], by: 'day' }).success).toBe(true);
    }
    for (const name of ['revenue', ...expectedDerived]) {
      expect(schema.safeParse({ measures: [name], orderBy: [{ field: name, direction: 'asc' }] }).success).toBe(true);
      expect(canonicalSchema.safeParse({ dataset: 'orders', measures: [name] }).success).toBe(true);
    }
    expect(ds.measures.growth.uses.running).toBe('runningRevenue');
    const client = createDatasetClient({ queryBuilder: createRenderingBuilderFactory() });
    expect(client.validate(ds, { measures: ['growth'], by: 'day' }).errors)
      .toContain('Window measures require exactly one bounded time range: between, or gt/gte with lt/lte, using ISO timestamps.');
  });

  it('keeps every measure kind in the public measures registry', () => {
    const ds = dataset('orders', {
      source: 'orders',
      timeKey: 'createdAt',
      dimensions: { createdAt: dimension.timestamp(), amount: dimension.number() },
      measures: {
        revenue: measure.sum('amount'),
        trailingRevenue: measure.trailing('revenue', { amount: 7, unit: 'day' }),
        monthToDate: measure.toDate('revenue', 'month'),
        runningRevenue: measure.cumulative('revenue'),
        revenueRatio: measure.derived({
          uses: { current: 'revenue' },
          formula: ({ current }) => divide(current, nullIfZero(current)),
        }),
      },
    });
    expect(Object.keys(ds.measures)).toEqual(['revenue', 'trailingRevenue', 'monthToDate', 'runningRevenue', 'revenueRatio']);
    expect('windowMeasures' in ds).toBe(false);
    expect(ds.measures.trailingRevenue.trailing).toEqual({ amount: 7, unit: 'day' });
    expect(Object.keys(ds.derivedMeasures)).toEqual(['revenueRatio']);
    expect(ds.derivedMeasures.revenueRatio).toBe(ds.measures.revenueRatio);
    expect(ds.metric('totalRevenue', { measure: 'revenue' }).contract().measures).toEqual(['revenue']);
    const client = createDatasetClient({ queryBuilder: createRenderingBuilderFactory() });
    expect(client.toSQL(ds, {})).toBe('SELECT SUM(amount) AS revenue FROM orders');
    expect(client.toSQL(ds, { measures: ['revenueRatio'] })).toContain('NULLIF');
    // JavaScript callers cannot turn a non-aggregate definition into a metric.
    // @ts-expect-error Deliberately invalid input exercises JavaScript runtime validation.
    expect(() => ds.metric('invalid', { measure: 'runningRevenue' })).toThrow(/must be a base measure/);
    // @ts-expect-error Deliberately invalid input exercises JavaScript runtime validation.
    expect(() => ds.metric('invalid', { measure: 'revenueRatio' })).toThrow(/must be a base measure/);
  });

  it('executes only base measures by default on a semantic backend', async () => {
    const ds = dataset('orders', {
      source: 'orders', timeKey: 'createdAt',
      dimensions: { createdAt: dimension.timestamp(), amount: dimension.number() },
      measures: {
        revenue: measure.sum('amount'),
        runningRevenue: measure.cumulative('revenue'),
        revenueRatio: measure.derived({
          uses: { current: 'revenue' },
          formula: ({ current }) => divide(current, nullIfZero(current)),
        }),
      },
    });
    const client = createDatasetClient({
      backend: createInMemoryBackend({ orders: [{ amount: 10 }, { amount: 20 }] }),
    });
    expect((await client.execute(ds)).data).toEqual([{ revenue: '30' }]);
    expect(client.validate(ds, { measures: [] }).valid).toBe(false);
  });

  it('rejects invalid references, missing time keys, and unbounded cumulative aggregations', () => {
    expect(() => orders({ revenue: measure.sum('amount'), bad: measure.cumulative('missing') }))
      .toThrow(/must wrap a base measure/);
    expect(() => dataset('orders', {
      source: 'orders', dimensions: { amount: dimension.number() },
      measures: { revenue: measure.sum('amount'), bad: measure.cumulative('revenue') },
    })).toThrow(/requires a timeKey/);
    expect(() => orders({ revenue: measure.countDistinct('amount'), bad: measure.cumulative('revenue') }))
      .toThrow(/cannot accumulate countDistinct/);
    expect(() => orders({ revenue: measure.sum('amount'), bad: measure.trailing('revenue', { amount: 0, unit: 'day' }) }))
      .toThrow(/positive safe integer/);
  });

  // Paths the typed helpers prevent but untyped (JS / JSON) definitions can still hit.
  it.each([
    ['an unsafe name', { 'bad name': measure.cumulative('revenue') }, /name is not a safe identifier/],
    ['a window over a window', { run: measure.cumulative('revenue'), bad: measure.cumulative('run') }, /must wrap a base measure; "run"/],
    ['no mode', { bad: { __type: 'window_measure_definition', measure: 'revenue' } }, /exactly one window mode/],
    ['two modes', { bad: { ...measure.cumulative('revenue'), toDate: 'month' } }, /exactly one window mode/],
    ['a null trailing interval', { bad: { __type: 'window_measure_definition', measure: 'revenue', trailing: null } }, /positive safe integer/],
    ['a fractional trailing amount', { bad: measure.trailing('revenue', { amount: 1.5, unit: 'day' }) }, /positive safe integer/],
    ['an unknown trailing unit', { bad: measure.trailing('revenue', { amount: 7, unit: 'fortnight' as 'day' }) }, /positive safe integer and supported unit/],
    ['toDate minute', { bad: measure.toDate('revenue', 'minute' as 'hour') }, /coarser than minute/],
    ['cumulative false', { bad: { ...measure.cumulative('revenue'), cumulative: false } }, /cumulative must be true/],
  ])('rejects %s', (_label, windows, error) => {
    expect(() => orders({ revenue: measure.sum('amount'), ...(windows as Record<string, ReturnType<typeof measure.cumulative>>) }))
      .toThrow(error);
  });

  it('accepts each well-formed window mode', () => {
    expect(() => orders({
      revenue: measure.sum('amount'),
      trailing7d: measure.trailing('revenue', { amount: 7, unit: 'day' }),
      monthToDate: measure.toDate('revenue', 'month'),
      running: measure.cumulative('revenue'),
    })).not.toThrow();
  });

  it('requires bounded time ranges and refuses contract 2 publishing', () => {
    const ds = orders({ revenue: measure.sum('amount'), runningRevenue: measure.cumulative('revenue') });
    const client = createDatasetClient({ queryBuilder: createRenderingBuilderFactory() });
    expect(client.validate(ds, { measures: ['runningRevenue'], by: 'day' }).errors)
      .toContain('Window measures require exactly one bounded time range: between, or gt/gte with lt/lte, using ISO timestamps.');
    expect(() => buildProtocolDeploymentContract([ds])).toThrow(/need deployment contract 3/);

    const withGrowth = dataset('orders', {
      source: 'orders', timeKey: 'createdAt',
      dimensions: { createdAt: dimension.timestamp(), amount: dimension.number() },
      measures: {
        revenue: measure.sum('amount'),
        runningRevenue: measure.cumulative('revenue'),
        growth: measure.derived({
          uses: { running: 'runningRevenue', current: 'revenue' },
          formula: ({ running, current }) => divide(current, nullIfZero(running)),
        }),
      },
    });
    expect(client.validate(withGrowth, { measures: ['growth'], by: 'day' }).errors)
      .toContain('Window measures require exactly one bounded time range: between, or gt/gte with lt/lte, using ISO timestamps.');
  });
});
