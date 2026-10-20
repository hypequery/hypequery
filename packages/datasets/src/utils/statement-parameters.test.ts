import { describe, expect, it } from 'vitest';
import type { DatasetSqlDialectRules } from '../dataset-sql-dialect.js';
import { clickhouseDatasetSqlDialect } from './clickhouse-dataset-sql-dialect.js';
import { StatementParameters, renderStatement } from './statement-parameters.js';

/** A Postgres-shaped test dialect: numbered, re-used placeholders, no positional pieces. */
const numbered: DatasetSqlDialectRules = Object.freeze({
  ...clickhouseDatasetSqlDialect,
  name: 'numbered',
  placeholder: (index: number) => `$${index + 1}`,
  reusesPlaceholders: true,
  embedsPositionalPieces: false,
});

describe('StatementParameters', () => {
  it('renders ClickHouse placeholders as positional ? in text order', () => {
    const statement = new StatementParameters(clickhouseDatasetSqlDialect);
    const second = statement.bind('b');
    const first = statement.bind('a');
    expect(statement.render(`x = ${first} AND y = ${second}`))
      .toEqual({ sql: 'x = ? AND y = ?', parameters: ['a', 'b'] });
  });

  it('numbers placeholders by text position, not bind order', () => {
    const statement = new StatementParameters(numbered);
    const later = statement.bind(2);
    const earlier = statement.bind(1);
    expect(statement.render(`a = ${earlier} OR b = ${later}`))
      .toEqual({ sql: 'a = $1 OR b = $2', parameters: [1, 2] });
  });

  it('duplicates a re-used value on positional dialects and re-uses it on numbered ones', () => {
    const positional = new StatementParameters(clickhouseDatasetSqlDialect);
    const p = positional.bind('t');
    expect(positional.render(`${p}, ${p}`)).toEqual({ sql: '?, ?', parameters: ['t', 't'] });

    const reusing = new StatementParameters(numbered);
    const tenant = reusing.bind('t');
    const other = reusing.bind(5);
    expect(reusing.render(`${tenant}, ${other}, ${tenant}`))
      .toEqual({ sql: '$1, $2, $1', parameters: ['t', 5] });
  });

  it('interleaves embedded builder parameters with bound values in text order', () => {
    const statement = new StatementParameters(clickhouseDatasetSqlDialect);
    const after = statement.bind('after');
    const base = statement.embed({ sql: 'SELECT * FROM t WHERE a = ? AND b IN (?, ?)', parameters: [1, 2, 3] });
    const before = statement.bind('before');
    expect(statement.render(`${before} | WITH base AS (${base}) | ${after}`)).toEqual({
      sql: '? | WITH base AS (SELECT * FROM t WHERE a = ? AND b IN (?, ?)) | ?',
      parameters: ['before', 1, 2, 3, 'after'],
    });
  });

  it('renders each statement of a family independently', () => {
    const statement = new StatementParameters(clickhouseDatasetSqlDialect);
    const source = statement.embed({ sql: 'SELECT ? AS x', parameters: ['tenant'] });
    const bound = statement.bind(9);
    expect(statement.render(`WITH s AS (${source}) SELECT 1`)).toEqual({ sql: 'WITH s AS (SELECT ? AS x) SELECT 1', parameters: ['tenant'] });
    expect(statement.render(`WITH s AS (${source}) SELECT ${bound}`)).toEqual({ sql: 'WITH s AS (SELECT ? AS x) SELECT ?', parameters: ['tenant', 9] });
  });

  it('keeps logical types beside bound values for the dialect', () => {
    const seen: unknown[] = [];
    const typed = new StatementParameters({ ...numbered, placeholder: (index, parameter) => { seen.push(parameter); return `$${index + 1}`; } });
    const marker = typed.bind(3, 'number');
    typed.render(marker);
    expect(seen).toEqual([{ value: 3, type: 'number' }]);
  });

  it('rejects positional builder SQL on dialects that number placeholders', () => {
    const statement = new StatementParameters(numbered);
    expect(() => statement.embed({ sql: 'SELECT ?', parameters: [1] }))
      .toThrow(/"numbered" datasets dialect cannot embed positional query builder SQL/);
  });

  it('rejects builder SQL that already carries markers', () => {
    const statement = new StatementParameters(clickhouseDatasetSqlDialect);
    const marker = statement.bind(1);
    expect(() => statement.embed({ sql: `SELECT ${marker}`, parameters: [] })).toThrow(/cannot contain datasets statement markers/);
  });

  it('fails closed on markers from another compilation', () => {
    const one = new StatementParameters(clickhouseDatasetSqlDialect);
    const other = new StatementParameters(clickhouseDatasetSqlDialect);
    expect(() => one.render(`x = ${other.bind(1)}`)).toThrow(/another compilation/);
  });

  it('fails closed on unknown and malformed markers', () => {
    const statement = new StatementParameters(clickhouseDatasetSqlDialect);
    const marker = statement.bind(1);
    const nonce = /\uE000([0-9a-f]+):/.exec(marker)![1];
    expect(() => statement.render(`\uE000${nonce}:v:7\uE001`)).toThrow(/unknown parameter marker/);
    expect(() => statement.render(`\uE000${nonce}:b:0\uE001`)).toThrow(/unknown builder marker/);
    expect(() => statement.render(`${marker.slice(0, -1)} AND 1`)).toThrow(/malformed parameter marker/);
    expect(() => statement.render('stray \uE001')).toThrow(/malformed parameter marker/);
  });

  it('cannot be forged by text that guesses a marker', () => {
    const statement = new StatementParameters(clickhouseDatasetSqlDialect);
    statement.bind(1);
    expect(() => statement.render("x = '\uE0000000000000000000:v:0\uE001'")).toThrow(/another compilation/);
  });

  it('uses a distinct nonce per allocator', () => {
    const markers = new Set(Array.from({ length: 20 }, () => new StatementParameters(clickhouseDatasetSqlDialect).bind(1)));
    expect(markers.size).toBe(20);
  });

  it('renders planned statements through their own allocator', () => {
    const parameters = new StatementParameters(clickhouseDatasetSqlDialect);
    expect(renderStatement({ text: `a = ${parameters.bind('v')}`, parameters })).toEqual({ sql: 'a = ?', parameters: ['v'] });
  });
});
