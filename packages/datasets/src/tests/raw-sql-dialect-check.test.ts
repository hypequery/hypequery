/**
 * HQ-198: raw `sql` is validated at definition time with ClickHouse lexical
 * rules (definitions are engine-neutral), then re-checked at compile time
 * under the active engine's rules. The scenario below is safe on ClickHouse
 * and an injection on an engine without backslash string escapes.
 */

import { describe, expect, it, vi } from 'vitest';
import { dataset } from '../dataset.js';
import { createDatasetClient } from '../executor.js';
import { dimension } from '../field.js';
import { measure } from '../measure.js';
import type { QueryBuilderFactoryLike } from '../query-builder-protocol.js';
import type { MetricHandle } from '../types.js';
import { clickhouseDatasetSqlDialect } from '../utils/clickhouse-dataset-sql-dialect.js';
import { defineDatasetSqlDialectRules } from '../utils/dataset-sql-dialect.js';
import { createRenderingBuilderFactory } from './support/sql-equality-harness.js';
import { belongsTo } from '../relationships.js';

/** Test-only lexer for standard-conforming strings: a backslash is an ordinary character. */
function standardStringsError(sql: string): 'unterminated-literal' | 'statement-break' | undefined {
  let code = '';
  for (let index = 0; index < sql.length; index++) {
    const quote = sql[index];
    if (quote !== "'" && quote !== '"') { code += quote; continue; }
    let cursor = index + 1;
    for (;;) {
      if (cursor >= sql.length) return 'unterminated-literal';
      if (sql[cursor] === quote && sql[cursor + 1] === quote) { cursor += 2; continue; }
      if (sql[cursor] === quote) break;
      cursor++;
    }
    code += ' '.repeat(cursor - index + 1);
    index = cursor;
  }
  return /;|--|\/\*/.test(code) ? 'statement-break' : undefined;
}

const standardStrings = defineDatasetSqlDialectRules({
  ...clickhouseDatasetSqlDialect,
  name: 'standard-strings-test',
  rawSqlExpressionError: vi.fn(standardStringsError),
  quoteQualifiedName: (name: string) => `"${name.split('.').join('"."')}"`,
});

// Safe on ClickHouse: '\'' is one literal containing a quote. Without
// backslash escapes the first literal ends early and `; DROP` is live code.
const SMUGGLED = "concat('\\'', '; DROP TABLE orders; --')";

const Customers = dataset('customers', {
  source: 'crm.customers',
  dimensions: { id: dimension.number(), country: dimension.string() },
  measures: { customers: measure.countDistinct('id') },
});
const Orders = dataset('orders', {
  source: 'orders',
  timeKey: 'time',
  dimensions: {
    time: dimension.timestamp({ column: 'created_at' }),
    label: dimension.string({ sql: SMUGGLED }),
    amount: dimension.number(),
  },
  measures: { revenue: measure.sum('amount'), rolling: measure.trailing('revenue', { amount: 7, unit: 'day' }) },
  relationships: { customer: belongsTo(() => Customers, { from: 'customer_id', to: 'id' }) },
});
const Clean = dataset('clean', {
  source: 'orders',
  dimensions: { status: dimension.string(), amount: dimension.number(), cents: dimension.number({ sql: "amount * 100", dependencies: ['amount'] }) },
  measures: { revenue: measure.sum('amount'), customers: measure.countDistinct('customer_id') },
  relationships: { customer: belongsTo(() => Customers, { from: 'customer_id', to: 'id' }) },
});

const clickhouse = createDatasetClient({ queryBuilder: createRenderingBuilderFactory() });
const factory: QueryBuilderFactoryLike = { ...createRenderingBuilderFactory(), datasetSqlDialect: standardStrings };
const strict = createDatasetClient({ queryBuilder: factory });
// Either way the expression is not one safe expression under these rules.
const REJECTION = /Invalid dataset "orders" for the standard-strings-test datasets dialect: dimension "label" sql (must be a single expression|has an unterminated quoted literal)/;

describe('raw sql is re-checked under the active engine', () => {
  it('accepts the expression at definition time and on ClickHouse', () => {
    expect(clickhouse.toSQL(Orders, { dimensions: ['label'], measures: ['revenue'] })).toContain(SMUGGLED);
  });

  it('rejects it on an engine whose lexer sees the hidden terminator, on every path', () => {
    expect(() => strict.toSQL(Orders, { dimensions: ['label'], measures: ['revenue'] })).toThrow(REJECTION);
    // The whole dataset is checked, not only selected fields.
    expect(() => strict.toSQL(Orders, { measures: ['revenue'] })).toThrow(REJECTION);
    expect(() => strict.toSQL(Orders, {
      by: 'day', measures: ['rolling'],
      filters: [{ field: 'time', operator: 'between', value: ['2026-01-01', '2026-02-01'] }],
    })).toThrow(REJECTION);
    expect(() => strict.toSQL(Orders.metric('m', { measure: 'revenue' }) as MetricHandle as never, {} as never)).toThrow(REJECTION);
  });

  it('checks each dataset once per engine and skips ClickHouse-rule dialects', () => {
    const lexer = standardStrings.rawSqlExpressionError as ReturnType<typeof vi.fn>;
    lexer.mockClear();
    strict.toSQL(Clean, { dimensions: ['cents'], measures: ['revenue'] });
    strict.toSQL(Clean, { dimensions: ['status'], measures: ['revenue'] });
    expect(lexer).toHaveBeenCalledTimes(1);
    const partialHook = createDatasetClient({ queryBuilder: { ...createRenderingBuilderFactory(), datasetSqlDialect: { name: 'partial', quoteIdentifier: (id: string) => `"${id}"` } } });
    lexer.mockClear();
    partialHook.toSQL(Clean, { dimensions: ['cents'], measures: ['revenue'] });
    expect(lexer).not.toHaveBeenCalled();
  });

  it('quotes projected relationship sources with the dialect', () => {
    expect(strict.toSQL(Clean, { dimensions: ['status'], measures: ['revenue', 'customer.customers'] })).toContain('FROM "crm"."customers"');
  });
});
