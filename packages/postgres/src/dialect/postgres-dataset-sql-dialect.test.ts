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

  it('divides in floating point and rounds half to even like ClickHouse floats', () => {
    expect(pg.formulaBinary('divide', '"a"', '"b"')).toBe('(CAST("a" AS double precision) / "b")');
    expect(pg.formulaFunction('round', ['x', '2']))
      .toBe('(ROUND(CAST(x AS double precision) * CAST(1e2 AS double precision)) / CAST(1e2 AS double precision))');
    expect(pg.formulaFunction('round', ['x', '-1']))
      .toBe('(ROUND(CAST(x AS double precision) / CAST(1e1 AS double precision)) * CAST(1e1 AS double precision))');
    expect(pg.formulaFunction('round', ['x'])).toBe('ROUND(CAST(x AS double precision))');
    expect(() => pg.formulaFunction('round', ['x', 'y'])).toThrow(/decimal places/);
  });

  it('spells guards as a cast that fails with the message', () => {
    expect(pg.guard('n > 3', "it's too many")).toBe(
      "CAST(CASE WHEN n > 3 THEN '[hypequery] it''s too many' ELSE '0' END AS integer)",
    );
  });

  it('isolates columns as separately aliased columns', () => {
    expect(pg.isolateColumns('_hq_row', ['a', 'b'])).toEqual(['a AS _hq_row_1', 'b AS _hq_row_2']);
    expect(pg.isolatedColumn('_hq_row', 2)).toBe('_hq_row_2');
    expect(pg.isolatedColumnProbe('_hq_row', '_hq_raw', 1)).toBe('(SELECT _hq_row_1 FROM _hq_raw LIMIT 0)');
    expect(pg.selectAllExcept('s', ['x'], ['s.a', 's.b'])).toBe('s.a, s.b');
    expect(pg.derivedTable('SELECT 1', 't')).toBe('(SELECT 1) AS t');
  });

  it('chains aliased items through lateral steps', () => {
    expect(pg.selectWithAliasReferences([['1', 'a'], ['a + 1', 'b']]))
      .toBe('SELECT * FROM (SELECT 1 AS a) AS _hq_step0 CROSS JOIN LATERAL (SELECT a + 1 AS b) AS _hq_step1');
  });

  it('spells ASOF as a lateral nearest-earlier probe with NULL-safe keys', () => {
    expect(pg.asofLeftJoin('agg', 'm', [['s.p', 'm.p']], ['s.e', 'm.t'])).toBe(
      'LEFT JOIN LATERAL (SELECT * FROM agg AS m WHERE s.p IS NOT DISTINCT FROM m.p AND s.e > m.t ORDER BY m.t DESC LIMIT 1) AS m ON TRUE',
    );
  });

  describe('zoned rules (instants in the query timezone)', () => {
    const ny = pg.withQueryTimezone!('America/New_York');

    it('is memoized per zone and keeps the engine name', () => {
      expect(pg.withQueryTimezone!('America/New_York')).toBe(ny);
      expect(ny.name).toBe('postgres');
    });

    it('steps minutes and hours on instants, calendar units on the wall clock', () => {
      expect(ny.addTime('t', 2, 'hour')).toBe("((t) + (2) * INTERVAL '1 hour')");
      expect(ny.addTime('t', 1, 'month'))
        .toBe("(((t AT TIME ZONE 'America/New_York') + (1) * INTERVAL '1 month') AT TIME ZONE 'America/New_York')");
    });

    it('truncates in the zone and renders the period as a wall clock', () => {
      expect(ny.truncateTime('t', 'day')).toBe("date_trunc('day', t, 'America/New_York')");
      expect(ny.periodValue('p', 'hour')).toBe("(p AT TIME ZONE 'America/New_York')");
      expect(ny.periodValue('p', 'month')).toBe("CAST((p AT TIME ZONE 'America/New_York') AS date)");
    });

    it('parses offset bounds as instants and local bounds in the zone', () => {
      expect(ny.parseTimestamp('$1', ny.timezoneOf('x', 'America/New_York'))).toBe(
        "(CASE WHEN CAST($1 AS text) ~ '(Z|[+-][0-9]{2}:[0-9]{2})$' THEN CAST(CAST($1 AS text) AS timestamptz) "
        + "ELSE CAST(CAST($1 AS text) AS timestamp) AT TIME ZONE 'America/New_York' END)",
      );
    });
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
