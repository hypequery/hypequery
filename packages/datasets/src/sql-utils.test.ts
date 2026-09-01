import { describe, expect, it } from 'vitest';

import { dataset } from './dataset.js';
import { dimension } from './field.js';
import { divide, nullIfZero } from './formulas.js';
import { measure } from './measure.js';
import { eq, like } from './query-helpers.js';
import {
  escapeRegExp,
  isSafeSQLIdentifier,
  quoteSQLIdentifier,
  stripSqlLiterals,
  validateSQLIdentifier,
} from './sql-utils.js';

describe('sql-utils', () => {
  it('accepts safe SQL identifiers', () => {
    expect(isSafeSQLIdentifier('orders')).toBe(true);
    expect(isSafeSQLIdentifier('_tenant_1')).toBe(true);
    expect(isSafeSQLIdentifier('a1_b2')).toBe(true);
  });

  it('rejects unsafe SQL identifiers', () => {
    expect(isSafeSQLIdentifier('1orders')).toBe(false);
    expect(isSafeSQLIdentifier('order-id')).toBe(false);
    expect(isSafeSQLIdentifier('orders.total')).toBe(false);
    expect(isSafeSQLIdentifier('orders total')).toBe(false);
    expect(isSafeSQLIdentifier('')).toBe(false);
  });

  it('throws with context when validating unsafe identifiers', () => {
    expect(() => validateSQLIdentifier('order-id', 'dimension name')).toThrow(
      'Invalid dimension name: "order-id". Must contain only letters, numbers, and underscores, and start with a letter or underscore.',
    );
    expect(() => validateSQLIdentifier('order_id', 'dimension name')).not.toThrow();
  });

  it('quotes identifiers with backticks and escapes embedded backticks', () => {
    expect(quoteSQLIdentifier('orders')).toBe('`orders`');
    expect(quoteSQLIdentifier('bad`name')).toBe('`bad``name`');
  });
});

describe('metric validation through dataset()', () => {
  it('rejects sum and avg measures over non-numeric dimensions', () => {
    expect(() => dataset('bad_sum', {
      source: 'orders',
      dimensions: {
        id: dimension.string(),
        status: dimension.string(),
      },
      measures: {
        revenue: measure.sum('status'),
      },
    }).metric('revenue', { measure: 'revenue' })).toThrow(
      'Invalid metric "revenue": sum() requires a numeric dimension, but "status" is string.',
    );

    expect(() => dataset('bad_avg', {
      source: 'orders',
      dimensions: {
        id: dimension.string(),
        createdAt: dimension.timestamp(),
      },
      measures: {
        averageCreatedAt: measure.avg('createdAt'),
      },
    }).metric('averageCreatedAt', { measure: 'averageCreatedAt' })).toThrow(
      'Invalid metric "averageCreatedAt": avg() requires a numeric dimension, but "createdAt" is timestamp.',
    );
  });

  it('rejects measure filters with unknown fields, disallowed operators, or invalid values', () => {
    const ds = dataset('orders', {
      source: 'orders',
      dimensions: {
        id: dimension.string(),
        amount: dimension.number(),
        status: dimension.string(),
      },
      filters: {
        statusFilter: {
          __type: 'filter_definition',
          field: 'status',
          operators: ['eq'],
        },
      },
      measures: {
        unknownFilter: measure.sum('amount', { filters: [eq('missing', 'completed')] }),
        disallowedOperator: measure.sum('amount', { filters: [like('statusFilter', '%complete%')] }),
        invalidValue: measure.sum('amount', { filters: [eq('amount', 'not-a-number')] }),
      },
    });

    expect(() => ds.metric('unknownFilter', { measure: 'unknownFilter' })).toThrow(
      'measure filter field "missing" does not exist on dataset "orders"',
    );
    expect(() => ds.metric('disallowedOperator', { measure: 'disallowedOperator' })).toThrow(
      'measure filter "statusFilter" does not allow operator "like"',
    );
    expect(() => ds.metric('invalidValue', { measure: 'invalidValue' })).toThrow(
      '"eq" expects a number value for field "amount"',
    );
  });

  it('rejects derived metrics with no uses and metrics from another dataset', () => {
    const Orders = dataset('orders', {
      source: 'orders',
      dimensions: {
        id: dimension.string(),
        amount: dimension.number(),
      },
      measures: {
        revenue: measure.sum('amount'),
      },
    });
    const Customers = dataset('customers', {
      source: 'customers',
      dimensions: {
        id: dimension.string(),
      },
      measures: {
        customers: measure.count('id'),
      },
    });
    const revenue = Orders.metric('revenue', { measure: 'revenue' });
    const customers = Customers.metric('customers', { measure: 'customers' });

    expect(() => Orders.metric('emptyDerived', {
      uses: {},
      formula: () => divide('revenue', nullIfZero('orders')),
    })).toThrow('derived metrics must reference at least one base metric');

    expect(() => Orders.metric('crossDataset', {
      uses: { revenue, customers },
      formula: ({ revenue: revenueInput, customers: customersInput }) => divide(revenueInput, nullIfZero(customersInput)),
    })).toThrow('referenced metric "customers" belongs to dataset "customers", expected "orders"');
  });
});

describe('stripSqlLiterals', () => {
  it('blanks a single-quoted literal but keeps surrounding code', () => {
    // The 4-character literal `'; '` becomes 4 spaces; everything else survives.
    expect(stripSqlLiterals("concat(name, '; ')")).toBe('concat(name,     )');
  });

  it('preserves length so offsets survive', () => {
    const sql = "replaceAll(note, '--', '')";
    expect(stripSqlLiterals(sql)).toHaveLength(sql.length);
  });

  it('treats a doubled quote as an escape, not a close', () => {
    expect(stripSqlLiterals("a || 'it''s' || b")).toBe('a ||         || b');
  });

  it('treats a backslash as escaping the next character', () => {
    expect(stripSqlLiterals("'it\\'s'")).toBe('       ');
  });

  it('blanks double-quoted and backtick-quoted identifiers', () => {
    expect(stripSqlLiterals('"col" + `other`')).toBe('      +        ');
  });

  it('leaves an expression with no literals untouched', () => {
    expect(stripSqlLiterals('amount - discount')).toBe('amount - discount');
  });

  it('keeps quoted-identifier text when asked, blanking only the delimiters', () => {
    expect(stripSqlLiterals('`amount` - discount', { keepQuotedIdentifiers: true })).toBe(
      ' amount  - discount',
    );
  });

  it('still blanks string literals when keeping quoted identifiers', () => {
    // `'a;b'` is 5 characters, so 5 spaces; `` `col` `` keeps its text as ` col `.
    expect(stripSqlLiterals("concat('a;b', `col`)", { keepQuotedIdentifiers: true })).toBe(
      'concat(     ,  col )',
    );
  });

  it('preserves length in both modes', () => {
    const sql = '`amount` - "other"';
    expect(stripSqlLiterals(sql, { keepQuotedIdentifiers: true })).toHaveLength(sql.length);
    expect(stripSqlLiterals(sql)).toHaveLength(sql.length);
  });

  it('throws on an unterminated literal', () => {
    expect(() => stripSqlLiterals("name' ; DROP")).toThrow(/Unterminated ' literal/);
  });
});

describe('escapeRegExp', () => {
  it('escapes regex metacharacters', () => {
    expect(new RegExp(escapeRegExp('amount(')).test('amount(')).toBe(true);
  });

  it('stops a metacharacter from matching something else', () => {
    expect(new RegExp(`^${escapeRegExp('a+')}$`).test('aaa')).toBe(false);
  });
});
