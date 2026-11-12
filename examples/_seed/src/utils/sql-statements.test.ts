import { describe, expect, it } from 'vitest';
import { splitSqlStatements } from './sql-statements.js';

describe('splitSqlStatements', () => {
  it('splits on top-level semicolons and drops comments', () => {
    const sql = `
      -- leading comment; with a semicolon
      CREATE TABLE t (a UInt8); /* block; comment */
      INSERT INTO t VALUES (1);
      SELECT 'a;b' AS s, "x;y", \`q;r\`
    `;
    expect(splitSqlStatements(sql)).toEqual([
      'CREATE TABLE t (a UInt8)',
      'INSERT INTO t VALUES (1)',
      `SELECT 'a;b' AS s, "x;y", \`q;r\``,
    ]);
  });

  it('handles escaped and doubled quotes', () => {
    expect(splitSqlStatements(`SELECT 'it''s; fine'; SELECT 'back\\'slash; too'`)).toEqual([
      `SELECT 'it''s; fine'`,
      `SELECT 'back\\'slash; too'`,
    ]);
  });

  it('returns nothing for comment-only input', () => {
    expect(splitSqlStatements('-- nothing here\n/* or here */')).toEqual([]);
  });
});
