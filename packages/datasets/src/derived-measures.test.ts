import { describe, expect, it } from 'vitest';
import { dataset } from './dataset.js';
import { dimension } from './field.js';
import { coalesce, divide, multiply, nullIfZero, round } from './formulas.js';
import { measure } from './measure.js';
import { getDatasetCatalog } from './catalog.js';
import { assertDeployable, buildProtocolDeploymentContract } from './index.js';
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
      ...derivedMeasures,
    },
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

  it('rejects missing and cross-dataset dependencies', () => {
    const derived = measure.derived({
      uses: { revenue: 'revenue' },
      formula: ({ revenue }) => divide(revenue, nullIfZero(revenue)),
    });
    expect(() => defineOrders({ bad: { ...derived, uses: { revenue: 'missing' } } }))
      .toThrow(/missing measure "missing"/);
    expect(() => defineOrders({ bad: { ...derived, uses: { revenue: 'other.revenue' } } }))
      .toThrow(/cross-dataset measure/);

  });

  it('rejects cycles and unsafe aliases at definition time', () => {
    const derived = measure.derived({
      uses: { value: 'revenue' },
      formula: ({ value }) => divide(value, nullIfZero(value)),
    });
    expect(() => defineOrders({ first: { ...derived, uses: { second: 'second' } }, second: { ...derived, uses: { first: 'first' } } }))
      .toThrow(/dependency cycle/);
    expect(() => defineOrders({ revenue: derived })).toThrow(/dependency cycle/);
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
      measures: { constructor: measure.sum('amount'), ratio: constructorInput },
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

  it('catalogs a constructor alias as a formula reference', () => {
    const orders = defineOrders({
      ratio: measure.derived({
        uses: { constructor: 'revenue' },
        formula: ({ constructor: value }) => divide(value, nullIfZero(value)),
      }),
    });
    const expression = getDatasetCatalog(orders).derivedMeasures?.ratio.expression;
    expect(expression).toEqual({
      kind: 'binary', operator: 'divide',
      left: { kind: 'reference', name: 'constructor' },
      right: { kind: 'call', function: 'nullIfZero', args: [{ kind: 'reference', name: 'constructor' }] },
    });
    // Publishing uses the same conversion, so it must not leak Object either.
    const [published] = buildProtocolDeploymentContract([orders]).datasets;
    expect(JSON.stringify(published)).toContain('"name":"constructor"');
  });

  it('catalogs locally valid aliases that only publication refuses', () => {
    const longAlias = `a${'b'.repeat(128)}`;
    const orders = defineOrders({
      ratio: measure.derived({
        uses: { __hypequery_value: 'revenue', [longAlias]: 'orders' },
        formula: inputs => divide(inputs.__hypequery_value, nullIfZero(inputs[longAlias])),
      }),
    });
    // Discovery and query schemas build catalogs for local datasets that are never published.
    const expression = getDatasetCatalog(orders).derivedMeasures?.ratio.expression;
    expect(JSON.stringify(expression)).toContain('"name":"__hypequery_value"');
    expect(JSON.stringify(expression)).toContain(`"name":"${longAlias}"`);
    expect(() => buildProtocolDeploymentContract([orders])).toThrow();
  });
});

describe('deployable formulas', () => {
  const LITERAL_POSITIONS = 'literals are only accepted as round decimals or a coalesce fallback';
  // The helpers' signatures refuse a bare number; the runtime accepts one, as
  // the Python helpers do, so the deployment check has to name it.
  const literal = (value: unknown) => value as string;

  it('names the dataset and measure when a derived measure references another derived measure', () => {
    const orders = defineOrders({
      average: measure.derived({
        uses: { revenue: 'revenue', orders: 'orders' },
        formula: ({ revenue, orders }) => divide(revenue, nullIfZero(orders)),
      }),
      rounded: measure.derived({
        uses: { aov: 'average' },
        formula: ({ aov }) => round(aov, 2),
      }),
    });
    const message = 'orders.rounded: references derived measure "average" (as "aov"); '
      + 'a deployable formula may only reference base measures, so inline that formula or reference the base measures directly';
    expect(() => assertDeployable(orders)).toThrow(message);
    expect(() => buildProtocolDeploymentContract([orders])).toThrow(message);
  });

  it('names a literal used as an arithmetic operand', () => {
    const orders = defineOrders({
      doubled: measure.derived({
        uses: { revenue: 'revenue' },
        formula: ({ revenue }) => multiply(revenue, literal(2)),
      }),
    });
    const message = `orders.doubled: a numeric literal cannot be an arithmetic operand in a deployable formula; ${LITERAL_POSITIONS}`;
    expect(() => assertDeployable(orders)).toThrow(message);
    expect(() => buildProtocolDeploymentContract([orders])).toThrow(message);
  });

  it('names a literal passed to a function or used as a non-numeric coalesce fallback', () => {
    const guarded = defineOrders({
      guarded: measure.derived({
        uses: { revenue: 'revenue' },
        formula: ({ revenue }) => divide(revenue, nullIfZero(literal(0))),
      }),
    });
    expect(() => assertDeployable(guarded)).toThrow(
      `orders.guarded: a numeric literal cannot be the value passed to nullIfZero in a deployable formula; ${LITERAL_POSITIONS}`,
    );
    // The helpers cannot build a null fallback; a hand-written expression can.
    const nullable = defineOrders({
      nullable: measure.derived({
        uses: { revenue: 'revenue' },
        formula: ({ revenue }) => ({
          __type: 'formula_expr',
          expression: {
            kind: 'function', name: 'coalesce',
            args: [{ kind: 'ref', name: revenue }, { kind: 'literal', value: null }],
          },
          toSQL: () => `COALESCE(${revenue}, NULL)`,
        }),
      }),
    });
    expect(() => assertDeployable(nullable)).toThrow(
      'orders.nullable: a coalesce fallback must be a number in a deployable formula',
    );
  });

  it('accepts round decimals, coalesce fallbacks and references as the only literal positions', () => {
    const orders = defineOrders({
      roundedAverage: measure.derived({
        uses: { revenue: 'revenue', orders: 'orders' },
        formula: ({ revenue, orders }) => round(divide(revenue, nullIfZero(orders)), 2),
      }),
      safeShare: measure.derived({
        uses: { revenue: 'revenue', orders: 'orders' },
        formula: ({ revenue, orders }) => coalesce(divide(revenue, nullIfZero(orders)), 0),
      }),
      fallbackToOrders: measure.derived({
        uses: { revenue: 'revenue', orders: 'orders' },
        formula: ({ revenue, orders }) => coalesce(revenue, orders),
      }),
    });
    expect(() => assertDeployable(orders)).not.toThrow();
    const [published] = buildProtocolDeploymentContract([orders]).datasets;
    expect(published!.measures.map(entry => entry.name)).toEqual(
      expect.arrayContaining(['roundedAverage', 'safeShare', 'fallbackToOrders']),
    );
  });
});
