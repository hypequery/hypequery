import { describe, expect, it } from 'vitest';
import { resolveDatasetSqlDialect } from '@hypequery/datasets/internal';
import { createPostgresQueryBuilder, postgresDatasetSqlDialect as pg } from '../index.js';

describe('Postgres datasets SQL rules', () => {
  it('is used as-is by the datasets planner, not completed with ClickHouse rules', () => {
    expect(resolveDatasetSqlDialect(createPostgresQueryBuilder())).toBe(pg);
  });

  it('quotes identifiers and qualified names with double quotes', () => {
    expect(pg.quoteIdentifier('a"b')).toBe('"a""b"');
    expect(pg.quoteQualifiedName('analytics.Orders')).toBe('"analytics"."Orders"');
  });

  it('spells $n placeholders, re-used for a repeated value', () => {
    expect(pg.placeholder(0, { value: 1 })).toBe('$1');
    expect(pg.reusesPlaceholders).toBe(true);
    expect(pg.embedsPositionalPieces).toBe(false);
  });

  it('escapes string literals by doubling quotes only', () => {
    expect(pg.stringLiteral("it's \\")).toBe("'it''s \\'");
    expect(() => pg.stringLiteral('a\0b')).toThrow(/NUL/);
    expect(pg.measureFilterLiteral(true)).toBe('TRUE');
  });

  it('divides in floating point and rounds through numeric', () => {
    expect(pg.formulaBinary('divide', '"a"', '"b"')).toBe('(CAST("a" AS double precision) / "b")');
    expect(pg.formulaFunction('round', ['x', '2'])).toBe('CAST(ROUND(CAST(x AS numeric), 2) AS double precision)');
  });

  it('starts weeks on Sunday, like the shipped ClickHouse grain', () => {
    expect(pg.truncateTime('t', 'week')).toBe("(date_trunc('week', (t) + INTERVAL '1 day') - INTERVAL '1 day')::date");
    expect(pg.truncateTime('t', 'day')).toBe("date_trunc('day', t)");
    expect(pg.truncateTime('t', 'month')).toBe("date_trunc('month', t)::date");
  });

  it('has no FINAL modifier', () => {
    expect(pg.finalTable).toBeUndefined();
  });

  describe('raw SQL lexer', () => {
    it.each([
      ['upper(region)', undefined],
      ["'a;b' || x", undefined],
      ["'it''s; fine'", undefined],
      ["E'a\\';b'", undefined],
      ['$$ ; -- $$ || x', undefined],
      ['$tag$ ; $tag$', undefined],
      ['"weird;name"', undefined],
      ['x = $1', undefined],
      ['1; DROP TABLE t', 'statement-break'],
      ['x -- comment', 'statement-break'],
      ['x /* c */', 'statement-break'],
      // Standard strings do not escape quotes with a backslash: this closes
      // the literal and the `;` is code.
      ["'a\\'; DROP TABLE t", 'statement-break'],
      ["'open", 'unterminated-literal'],
      ['$q$ open', 'unterminated-literal'],
    ])('%s', (sql, expected) => {
      expect(pg.rawSqlExpressionError(sql)).toBe(expected);
    });
  });
});
