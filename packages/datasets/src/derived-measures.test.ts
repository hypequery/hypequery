import { describe, expect, it } from 'vitest';
import { dataset } from './dataset.js';
import { dimension } from './field.js';
import { divide, nullIfZero } from './formulas.js';
import { measure } from './measure.js';
import type { DerivedMeasureDefinition } from './types.js';

// Malformed inputs deliberately bypass the authoring constraint to test runtime validation.
function defineOrders(derivedMeasures: Record<string, DerivedMeasureDefinition>) {
  return dataset('orders', {
    source: 'orders',
    dimensions: {
      amount: dimension.number(),
      orderId: dimension.string(),
    },
    measures: {
      revenue: measure.sum('amount'),
      orders: measure.count('orderId'),
    },
    derivedMeasures: derivedMeasures as never,
  });
}

describe('dataset-owned derived measures', () => {
  it('keeps a typed formula and base measures on the dataset without creating a standalone metric', () => {
    const orders = defineOrders({
      averageOrderValue: measure.derived({
        uses: { revenue: 'revenue', orders: 'orders' },
        formula: ({ revenue, orders }) => divide(revenue, nullIfZero(orders)),
        label: 'Average order value',
      }),
    });

    expect(orders.derivedMeasures.averageOrderValue.uses).toEqual({
      revenue: 'revenue', orders: 'orders',
    });
    expect(orders.derivedMeasures.averageOrderValue.label).toBe('Average order value');
    expect(orders.metric('totalRevenue', { measure: 'revenue' }).contract().kind).toBe('metric');
  });

  it('rejects missing, cross-dataset, and derived-on-derived dependencies', () => {
    const derived = measure.derived({
      uses: { revenue: 'revenue' },
      formula: ({ revenue }) => divide(revenue, nullIfZero(revenue)),
    });
    expect(() => defineOrders({ bad: { ...derived, uses: { revenue: 'missing' } } }))
      .toThrow(/missing measure "missing"/);
    expect(() => defineOrders({ bad: { ...derived, uses: { revenue: 'other.revenue' } } }))
      .toThrow(/cross-dataset measure/);
    expect(() => defineOrders({ first: derived, second: { ...derived, uses: { first: 'first' } } }))
      .toThrow(/references derived measure "first"/);
  });

  it('rejects cycles, collisions, and unsafe aliases at definition time', () => {
    const derived = measure.derived({
      uses: { value: 'revenue' },
      formula: ({ value }) => divide(value, nullIfZero(value)),
    });
    expect(() => defineOrders({ first: { ...derived, uses: { second: 'second' } }, second: { ...derived, uses: { first: 'first' } } }))
      .toThrow(/dependency cycle/);
    expect(() => defineOrders({ revenue: derived })).toThrow(/collides with a base measure/);
    expect(() => defineOrders({ bad: { ...derived, uses: { 'bad-name': 'revenue' } } }))
      .toThrow(/invalid input alias/);
  });

  it('rejects invalid formula output or references outside declared aliases', () => {
    const derived = measure.derived({
      uses: { revenue: 'revenue' },
      formula: ({ revenue }) => divide(revenue, nullIfZero('unknown')),
    });
    expect(() => defineOrders({ bad: derived }))
      .toThrow(/undeclared input alias "unknown"/);
    expect(() => defineOrders({ bad: { ...derived, formula: () => null as never } }))
      .toThrow(/must return a FormulaExpr/);
    expect(() => defineOrders({
      bad: measure.derived({
        uses: { revenue: 'revenue', unused: 'orders' },
        formula: ({ revenue }) => divide(revenue, nullIfZero(revenue)),
      }),
    })).toThrow(/unused input alias "unused"/);
  });

  it('checks only own keys for base measures, derived measures, and formula aliases', () => {
    const constructorInput = measure.derived({
      uses: { value: 'constructor' },
      formula: ({ value }) => divide(value, nullIfZero(value)),
    });
    const orders = dataset('orders', {
      source: 'orders',
      dimensions: { amount: dimension.number() },
      measures: { constructor: measure.sum('amount') },
      derivedMeasures: { ratio: constructorInput },
    });
    expect(orders.derivedMeasures.ratio.uses.value).toBe('constructor');

    const namedConstructor = defineOrders({
      constructor: measure.derived({
        uses: { revenue: 'revenue' },
        formula: ({ revenue }) => divide(revenue, nullIfZero(revenue)),
      }),
    });
    expect(Object.hasOwn(namedConstructor.derivedMeasures, 'constructor')).toBe(true);

    const constructorAlias = defineOrders({
      ratio: measure.derived({
        uses: { constructor: 'revenue' },
        formula: ({ constructor: value }) => divide(value, nullIfZero(value)),
      }),
    });
    expect(constructorAlias.derivedMeasures.ratio.uses.constructor).toBe('revenue');

    expect(() => defineOrders({
      ratio: { ...constructorInput, uses: { value: 'toString' } },
    })).toThrow(/missing measure "toString"/);

    expect(() => defineOrders({
      ratio: measure.derived({
        uses: { revenue: 'revenue' },
        formula: ({ revenue }) => divide(revenue, nullIfZero('constructor')),
      }),
    })).toThrow(/undeclared input alias "constructor"/);
  });
});
