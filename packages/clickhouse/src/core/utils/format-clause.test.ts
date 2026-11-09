import { describe, expect, it } from 'vitest';
import { withFormatClause } from './format-clause.js';

const arrow = (sql: string) => withFormatClause(sql, 'ArrowStream');

describe('withFormatClause', () => {
  it('appends the clause on its own line', () => {
    expect(arrow('SELECT 1')).toBe('SELECT 1\nFORMAT ArrowStream');
  });

  it.each([
    ['SELECT 1;', 'SELECT 1'],
    ['SELECT 1 ;; \n', 'SELECT 1'],
    ['SELECT 1 -- trailing comment', 'SELECT 1'],
    ['SELECT 1; -- export', 'SELECT 1'],
    ['SELECT 1;\n/* done */', 'SELECT 1'],
    ['SELECT 1 /* outer /* nested */ still comment */;', 'SELECT 1'],
    ['SELECT 1 # mysql-style comment', 'SELECT 1'],
    ['SELECT 1 -- a\n-- b\n;', 'SELECT 1'],
  ])('drops trailing semicolons and comments: %j', (sql, statement) => {
    expect(arrow(sql)).toBe(`${statement}\nFORMAT ArrowStream`);
  });

  it.each([
    "SELECT '--not a comment;'",
    "SELECT 'it''s; -- fine'",
    "SELECT 'escaped \\' quote; --'",
    'SELECT 1 AS "a;--b"',
    'SELECT 1 AS `x /* y`',
    'SELECT $$ ; -- $$',
    'SELECT $tag$ ; /* $tag$',
  ])('keeps markers inside strings, identifiers and heredocs: %j', sql => {
    expect(arrow(sql)).toBe(`${sql}\nFORMAT ArrowStream`);
  });

  it('keeps comments and semicolons before the end of the statement', () => {
    expect(arrow('SELECT /* c */ 1 -- x\nFROM t;')).toBe('SELECT /* c */ 1 -- x\nFROM t\nFORMAT ArrowStream');
  });

  it('leaves an unclosed comment or string for ClickHouse to report', () => {
    expect(arrow('SELECT 1 /* open')).toBe('SELECT 1 /* open\nFORMAT ArrowStream');
    expect(arrow("SELECT 'open")).toBe("SELECT 'open\nFORMAT ArrowStream");
  });

  it('accepts a statement that already requests the same format', () => {
    expect(arrow('SELECT 1 FORMAT ArrowStream; -- done')).toBe('SELECT 1 FORMAT ArrowStream');
    expect(arrow('SELECT 1 format `ArrowStream`')).toBe('SELECT 1 format `ArrowStream`');
  });

  it('appends to a statement with another format, for ClickHouse to reject', () => {
    expect(arrow('SELECT 1 FORMAT JSONEachRow')).toBe('SELECT 1 FORMAT JSONEachRow\nFORMAT ArrowStream');
  });

  it('does not mistake a column named format for the clause', () => {
    expect(arrow('SELECT format FROM t')).toBe('SELECT format FROM t\nFORMAT ArrowStream');
    expect(arrow("SELECT format('{}', x)")).toBe("SELECT format('{}', x)\nFORMAT ArrowStream");
    expect(arrow('SELECT format FROM t ORDER BY format DESC')).toBe('SELECT format FROM t ORDER BY format DESC\nFORMAT ArrowStream');
    expect(arrow('SELECT 1 AS format')).toBe('SELECT 1 AS format\nFORMAT ArrowStream');
  });
});
