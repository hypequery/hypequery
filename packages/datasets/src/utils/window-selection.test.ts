import { describe, expect, it } from 'vitest';
import { dataset } from '../dataset.js';
import { dimension } from '../field.js';
import { divide, nullIfZero } from '../formulas.js';
import { measure } from '../measure.js';
import { selectedWindowMeasures } from './window-query-measures.js';
import { usesWindowMeasure } from './window-measure-dependencies.js';

const Sales = dataset('sales', {
  source: 'sales', timeKey: 'time', dimensions: { time: dimension.timestamp(), amount: dimension.number() },
  measures: {
    revenue: measure.sum('amount'), running: measure.cumulative('revenue'),
    ratio: measure.derived({ uses: { total: 'running', value: 'revenue' }, formula: ({ total, value }) => divide(value, nullIfZero(total)) }),
    baseRatio: measure.derived({ uses: { value: 'revenue' }, formula: ({ value }) => divide(value, nullIfZero(value)) }),
  },
});

describe('window dependency selection', () => {
  it('collects direct and formula window inputs once without including base inputs', () => {
    expect([...selectedWindowMeasures(Sales, { measures: ['ratio', 'running', 'revenue'] }).keys()]).toEqual(['running']);
    expect(selectedWindowMeasures(Sales, {}).size).toBe(0);
    expect(selectedWindowMeasures(Sales, { measures: ['baseRatio', 'toString'] }).size).toBe(0);
  });

  it('distinguishes formulas over window inputs from formulas over base inputs', () => {
    expect(usesWindowMeasure(Sales.measures.ratio, Sales.measures)).toBe(true);
    expect(usesWindowMeasure(Sales.measures.baseRatio, Sales.measures)).toBe(false);
    expect(usesWindowMeasure(Sales.measures.ratio, {})).toBe(false);
  });
});
