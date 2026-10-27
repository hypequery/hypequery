import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { postgresDatasetSqlDialect } from './postgres-dataset-sql-dialect.js';
import { stripPostgresLiterals } from './strip-literals.js';

interface CorpusCase {
  readonly sql: string;
  /** Per character as Postgres's scanner reads it: `l` literal, `k` comment, `c` code; null if it can't scan. */
  readonly postgres: string | null;
}

const corpus = JSON.parse(readFileSync(new URL('../tests/lexer-corpus.json', import.meta.url), 'utf8')) as {
  readonly postgres: string;
  readonly cases: readonly CorpusCase[];
};

/** How the lexer reads each character, in the corpus's letters. */
function lexerMarks(sql: string): string {
  const stripped = stripPostgresLiterals(sql);
  return [...sql].map((char, index) => (stripped[index] === char ? 'c' : 'l')).join('');
}

/** Whitespace reads the same inside and outside a literal; compare only the rest. */
function visible(sql: string, marks: string): string {
  return [...marks].map((mark, index) => (/\s/.test(sql[index]!) ? '.' : mark)).join('');
}

describe(`raw SQL lexer against Postgres ${corpus.postgres}'s scanner (lexer-corpus.json)`, () => {
  const accepted = corpus.cases.filter((c) => postgresDatasetSqlDialect.rawSqlExpressionError(c.sql) === undefined);

  it('reads every expression it accepts exactly as Postgres does', () => {
    const disagreements = accepted
      .filter((c) => c.postgres !== null)
      .filter((c) => visible(c.sql, lexerMarks(c.sql)) !== visible(c.sql, c.postgres!))
      .map((c) => ({ sql: c.sql, lexer: lexerMarks(c.sql), postgres: c.postgres }));
    expect(disagreements).toEqual([]);
  });

  it('accepts nothing Postgres reads a comment or terminator in', () => {
    const breaks = accepted.filter((c) => c.postgres !== null && (
      c.postgres.includes('k') || [...c.sql].some((char, index) => char === ';' && c.postgres![index] === 'c')
    ));
    expect(breaks.map((c) => c.sql)).toEqual([]);
  });

  it('still accepts the plain expressions Postgres scans', () => {
    // Refusing everything would pass the checks above; the corpus keeps the
    // lexer honest about plain quoting.
    expect(accepted.length).toBeGreaterThan(corpus.cases.length / 4);
    for (const sql of ["'a;b' || x", "'it''s; fine'", "x || E'a\\';b'", '"weird;name"', "B'01''1'", "date'2026-01-01'"]) {
      expect(postgresDatasetSqlDialect.rawSqlExpressionError(sql), sql).toBeUndefined();
    }
  });
});
