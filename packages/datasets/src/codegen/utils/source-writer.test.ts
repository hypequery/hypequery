import { describe, expect, it } from 'vitest';

import { datasetConstantNames } from './naming.js';
import { code, literal, stringLiteral } from './source-writer.js';

describe('source writer', () => {
  it('quotes strings so they read back as the same value', () => {
    for (const value of ['plain', "it's", 'say "hi"', `both ' and "`, 'a\\b', 'line\nbreak', ' ', '\u0001']) {
      const written = stringLiteral(value);
      // Every written literal is valid JSON once its quotes are normalised.
      const asJson = written.startsWith("'")
        ? `"${written.slice(1, -1).replace(/\\'/g, "'").replace(/"/g, '\\"')}"`
        : written.replace(/\\"/g, '\\"');
      expect(JSON.parse(asJson)).toBe(value);
    }
    expect(stringLiteral("it's")).toBe('"it\'s"');
  });

  it('writes short values on one line, keys bare where possible, and shorthand properties', () => {
    expect(literal({ a: 1, 'b-c': [true, null], __proto__x: 'y' })).toBe("{ a: 1, 'b-c': [true, null], __proto__x: 'y' }");
    expect(literal(JSON.parse('{"__proto__": 1}'))).toBe("{ '__proto__': 1 }");
    expect(literal({ datasets: code('datasets'), other: code('X') })).toBe('{ datasets, other: X }');
    expect(literal({ skipped: undefined, kept: 0 })).toBe('{ kept: 0 }');
    expect(() => literal(Number.NaN)).toThrow();
  });

  it('names dataset constants as generate:datasets does, uniquely', () => {
    expect([...datasetConstantNames(['order_items', 'orders', 'order-items', '2024_sales']).entries()]).toEqual([
      ['2024_sales', 'Dataset2024SalesDataset'],
      ['order-items', 'OrderItemsDataset'],
      ['order_items', 'OrderItemsDataset2'],
      ['orders', 'OrdersDataset'],
    ]);
  });
});
