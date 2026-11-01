import { describe, expect, it } from 'vitest';
import { GRAIN_FUNCTIONS, SUPPORTED_TIME_GRAINS, isSupportedTimeGrain } from '../constants.js';
import { measure } from '../measure.js';
import type { MeasureDefinition, TimeGrain } from '../types.js';
import { clickhouseDatasetSqlDialect as ch } from './clickhouse-dataset-sql-dialect.js';

describe('ClickHouse datasets SQL rules', () => {
  it('quotes identifiers and escapes string literals', () => {
    expect(ch.quoteIdentifier('odd`name')).toBe('`odd``name`');
    expect(ch.stringLiteral("it's \\ here")).toBe("'it''s \\\\ here'");
  });

  it.each([
    [null, 'NULL'], ['a\'b\\', "'a''b\\\\'"], [5, '5'], [-1.5, '-1.5'], [true, '1'], [false, '0'],
  ] as const)('renders measure filter literal %s', (value, sql) => {
    expect(ch.measureFilterLiteral(value)).toBe(sql);
  });

  it('rejects unsafe measure filter literals', () => {
    expect(() => ch.measureFilterLiteral(Infinity)).toThrow(/non-finite/);
    expect(() => ch.measureFilterLiteral({})).toThrow(/Unsupported literal type/);
  });

  it.each([
    ['minute', 'toStartOfMinute', 'Minutes'], ['hour', 'toStartOfHour', 'Hours'],
    ['day', 'toStartOfDay', 'Days'], ['week', 'toStartOfWeek', 'Weeks'],
    ['month', 'toStartOfMonth', 'Months'], ['quarter', 'toStartOfQuarter', 'Quarters'],
    ['year', 'toStartOfYear', 'Years'],
  ] as const)('spells %s time arithmetic', (grain, truncate, unit) => {
    expect(ch.truncateTime('t', grain)).toBe(`${truncate}(t)`);
    expect(ch.truncateTimeInZone('t', grain, 'z')).toBe(`toDateTime64(${truncate}(t), 9, z)`);
    expect(ch.addTime('t', 'n + 1', grain)).toBe(`add${unit}(t, n + 1)`);
    expect(ch.subtractTime('t', 2, grain)).toBe(`subtract${unit}(t, 2)`);
    expect(ch.timeDiff(grain, 'a', 'b')).toBe(`dateDiff('${grain}', a, b)`);
  });

  it('spells timezone conversion, parsing and inspection', () => {
    expect(ch.toQueryTimezone('t', 'Asia/Tokyo')).toBe("toDateTime64(t, 9, 'Asia/Tokyo')");
    expect(ch.parseTimestamp('?', 'z')).toBe('parseDateTime64BestEffort(?, 9, z)');
    expect(ch.timezoneOf('t')).toBe('timezoneOf(t)');
    expect(ch.clockPart('Minute', 't')).toBe('toMinute(t)');
    expect(ch.isDateOnlyType('v')).toBe("position(toTypeName(v), 'Date') > 0 AND position(toTypeName(v), 'DateTime') = 0");
  });

  it('spells guards and scalar helpers', () => {
    expect(ch.guard('x > 1', "can't")).toBe("throwIf(x > 1, 'can''t')");
    expect(ch.ifElse('c', 'a', 'b')).toBe('if(c, a, b)');
    expect(ch.greatest('a', 'b', 'c')).toBe('greatest(a, b, c)');
    expect(ch.least('a', 'b')).toBe('least(a, b)');
    expect(ch.isNotDistinctFrom('a', 'b')).toBe('isNotDistinctFrom(a, b)');
    expect(ch.isNotNull('a')).toBe('isNotNull(a)');
    expect(ch.assumeNotNull('a')).toBe('assumeNotNull(a)');
    expect(ch.toNullable('1')).toBe('toNullable(1)');
    expect(ch.countIf('c')).toBe('countIf(c)');
    expect(ch.seriesIndex('n')).toBe('arrayJoin(range(toUInt64(n)))');
    expect(ch.anyIndex('i', 'n', 'i > 2')).toBe('arrayExists(i -> i > 2, range(toUInt64(n)))');
  });

  it('spells row packing and structural clauses', () => {
    expect(ch.packRow(['a', 'b'])).toBe('tuple(a, b)');
    expect(ch.rowElement('r', 3)).toBe('tupleElement(r, 3)');
    expect(ch.selectAllExcept('s', ['a', 'b'])).toBe('s.* EXCEPT (a, b)');
    expect(ch.asofLeftJoin).toBe('LEFT ASOF JOIN');
  });

  it('spells ordering and pagination', () => {
    expect(ch.orderTerm('`x`', 'DESC')).toBe('`x` DESC');
    expect(ch.orderTerm('period')).toBe('period');
    expect(ch.paginate(undefined, undefined)).toBe('');
    expect(ch.paginate(10, undefined)).toBe(' LIMIT 10');
    expect(ch.paginate(undefined, 5)).toBe(' OFFSET 5');
    expect(ch.paginate(10, 5)).toBe(' LIMIT 10 OFFSET 5');
  });

  it('quotes qualified source paths per segment', () => {
    expect(ch.quoteQualifiedName('analytics.orders')).toBe('`analytics`.`orders`');
    expect(ch.quoteQualifiedName('odd`db.t')).toBe('`odd``db`.`t`');
  });

  it.each([
    ["concat(name, '; ')", undefined],
    ["replaceAll(note, '--', '')", undefined],
    ["concat('it''s', ';')", undefined],
    ["concat('\\'', '; DROP')", undefined],
    ['amount * 2', undefined],
    ['amount; DROP TABLE x', 'statement-break'],
    ['amount -- trailing', 'statement-break'],
    ['amount /* hidden */', 'statement-break'],
    ["concat('open", 'unterminated-literal'],
  ] as const)('checks raw sql %s', (sql, error) => {
    expect(ch.rawSqlExpressionError(sql)).toBe(error);
  });

  it('wraps filtered aggregate inputs', () => {
    expect(ch.filteredAggregateInput('c', 'v', '0')).toBe('if(c, v, 0)');
    expect(ch.filteredAggregateInput('c', 'v', 'NULL')).toBe('if(c, v, NULL)');
  });

  it.each([
    [measure.count('x'), 'count(v)'],
    [measure.countDistinct('x'), 'uniqExact(v)'],
    [measure.approxCountDistinct('x'), 'uniq(v)'],
    [measure.percentile('x', 0.9), 'quantileOrNull(0.9)(v)'],
    [measure.argMax('x', 'y'), 'argMaxOrNull(v, a)'],
    [measure.argMin('x', 'y'), 'argMinOrNull(v, a)'],
    [measure.stddev('x'), 'stddevSampOrNull(v)'],
    [measure.variance('x'), 'varSampOrNull(v)'],
    [measure.sum('x'), 'sumOrNull(v)'],
    [measure.avg('x'), 'avgOrNull(v)'],
    [measure.min('x'), 'minOrNull(v)'],
    [measure.max('x'), 'maxOrNull(v)'],
  ])('renders the %s window aggregate', (definition, sql) => {
    expect(ch.windowAggregate(definition as MeasureDefinition, 'v', 'a')).toBe(sql);
  });

  it('re-aggregates partials', () => {
    expect(ch.reaggregate('sum', 'p')).toBe('sumOrNull(p)');
    expect(ch.reaggregate('max', 'p')).toBe('maxOrNull(p)');
  });

  it('renders formula nodes', () => {
    expect(ch.formulaLiteral(null)).toBe('NULL');
    expect(ch.formulaLiteral(2.5)).toBe('2.5');
    expect(ch.formulaLiteral(true)).toBe('true');
    expect(ch.formulaLiteral("a'b")).toBe("'a''b'");
    expect(() => ch.formulaLiteral(NaN)).toThrow(/non-finite/);
    expect(ch.formulaBinary('add', 'a', 'b')).toBe('(a + b)');
    expect(ch.formulaBinary('subtract', 'a', 'b')).toBe('(a - b)');
    expect(ch.formulaBinary('multiply', 'a', 'b')).toBe('(a * b)');
    expect(ch.formulaBinary('divide', 'a', 'b')).toBe('(toFloat64(a) / b)');
    expect(() => ch.formulaBinary('modulo' as never, 'a', 'b')).toThrow(/unsupported binary operator/);
    expect(ch.formulaFunction('nullIfZero', ['a'])).toBe('NULLIF(a, 0)');
    expect(ch.formulaFunction('coalesce', ['a', '0'])).toBe('COALESCE(a, 0)');
    expect(ch.formulaFunction('round', ['a', '2'])).toBe('ROUND(a, 2)');
    expect(ch.formulaFunction('floor', ['a'])).toBe('FLOOR(a)');
    expect(ch.formulaFunction('ceil', ['a'])).toBe('CEIL(a)');
    expect(() => ch.formulaFunction('sqrt' as never, ['a'])).toThrow(/unsupported function/);
  });

  it('is frozen', () => {
    expect(Object.isFrozen(ch)).toBe(true);
  });
});

describe('time grain constants', () => {
  it('lists every grain, finest first, independently of engine spelling', () => {
    expect(SUPPORTED_TIME_GRAINS).toEqual(['minute', 'hour', 'day', 'week', 'month', 'quarter', 'year']);
    for (const grain of SUPPORTED_TIME_GRAINS) expect(isSupportedTimeGrain(grain)).toBe(true);
    for (const value of ['fortnight', 'toString', '__proto__', 1, null]) expect(isSupportedTimeGrain(value)).toBe(false);
  });

  it('keeps the deprecated GRAIN_FUNCTIONS export aligned with the ClickHouse rules', () => {
    for (const grain of SUPPORTED_TIME_GRAINS) {
      expect(`${GRAIN_FUNCTIONS[grain as TimeGrain]}(t)`).toBe(ch.truncateTime('t', grain));
    }
  });
});
