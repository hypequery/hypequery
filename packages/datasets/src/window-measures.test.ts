import { describe, expect, it } from 'vitest';
import { dataset } from './dataset.js';
import { createDatasetClient } from './executor.js';
import { dimension } from './field.js';
import { measure } from './measure.js';
import { divide, nullIfZero } from './formulas.js';
import { buildProtocolDeploymentContract } from './protocol-deployment-adapter.js';
import { createRenderingBuilderFactory } from './tests/support/sql-equality-harness.js';

function orders(measures: Record<string, ReturnType<typeof measure.sum> | ReturnType<typeof measure.cumulative>>) {
  return dataset('orders', {
    source: 'orders',
    timeKey: 'createdAt',
    dimensions: { createdAt: dimension.timestamp(), amount: dimension.number() },
    measures,
  });
}

describe('RFC 0015 window measure authoring', () => {
  it('keeps window definitions separate from base measures', () => {
    const ds = dataset('orders', {
      source: 'orders',
      timeKey: 'createdAt',
      dimensions: { createdAt: dimension.timestamp(), amount: dimension.number() },
      measures: {
        revenue: measure.sum('amount'),
        trailingRevenue: measure.trailing('revenue', { amount: 7, unit: 'day' }),
        monthToDate: measure.toDate('revenue', 'month'),
        runningRevenue: measure.cumulative('revenue'),
      },
    });
    expect(Object.keys(ds.measures)).toEqual(['revenue']);
    expect(Object.keys(ds.windowMeasures)).toEqual(['trailingRevenue', 'monthToDate', 'runningRevenue']);
    expect(ds.windowMeasures.trailingRevenue.trailing).toEqual({ amount: 7, unit: 'day' });
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

  it('refuses execution and contract 2 publishing until window planning is implemented', () => {
    const ds = orders({ revenue: measure.sum('amount'), runningRevenue: measure.cumulative('revenue') });
    const client = createDatasetClient({ queryBuilder: createRenderingBuilderFactory() });
    expect(client.validate(ds, { measures: ['runningRevenue'], by: 'day' }).errors)
      .toContain('Window measure "runningRevenue" is not executable until RFC 0015 window planning is available.');
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
      .toContain('Derived measure "growth" uses a window measure and is not executable until RFC 0015 window planning is available.');
  });
});
