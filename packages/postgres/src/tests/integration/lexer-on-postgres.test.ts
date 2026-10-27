/**
 * The raw-SQL lexer corpus against a live server.
 *
 * `lexer-corpus.json` records Postgres 18's scanner. This runs every
 * expression the lexer accepts on the server under test (CI: 14 and 17):
 * whatever it does with one, it must never read a second statement or a
 * comment in it.
 *
 * POSTGRES_URL=postgres://postgres@localhost:55432/postgres pnpm --filter @hypequery/postgres test:integration
 */
import { readFileSync } from 'node:fs';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { postgresDatasetSqlDialect } from '../../dialect/postgres-dataset-sql-dialect.js';

const url = process.env.POSTGRES_URL;
const corpus = JSON.parse(readFileSync(new URL('../lexer-corpus.json', import.meta.url), 'utf8')) as {
  readonly cases: readonly { readonly sql: string }[];
};

describe.skipIf(!url)('raw SQL lexer corpus on a live server', () => {
  let client: pg.Client;

  beforeAll(async () => {
    client = new pg.Client({ connectionString: url });
    await client.connect();
    await client.query('SET standard_conforming_strings = on');
  });

  afterAll(async () => {
    await client?.end();
  });

  it('never runs an accepted expression as more than one statement or with a trailing comment', async () => {
    const accepted = corpus.cases.filter((c) => postgresDatasetSqlDialect.rawSqlExpressionError(c.sql) === undefined);
    expect(accepted.length).toBeGreaterThan(500);
    const broken: { sql: string; error: string }[] = [];
    const run = async (text: string): Promise<string | undefined> => {
      try {
        // The extended protocol, as the driver sends it (node-postgres reads
        // `queryMode`, which its types omit).
        await client.query({ text, values: [], queryMode: 'extended' } as pg.QueryConfig);
        return undefined;
      } catch (error) {
        return (error as Error).message;
      }
    };
    for (const { sql } of accepted) {
      const ended = await run(`SELECT (${sql}\n) AS v, 1 AS "_hq_end"`);
      if (ended && /multiple commands|unterminated \/\* comment|at or near ";"/.test(ended)) {
        broken.push({ sql, error: ended });
        continue;
      }
      // A bare `;` in a syntax error is a terminator read as code. Runs only
      // when a newline follows it: the server read a `--` comment.
      if (ended === undefined && await run(`SELECT (${sql}) AS v, 1 AS "_hq_end"`) !== undefined) {
        broken.push({ sql, error: 'a line comment the lexer missed' });
      }
    }
    expect(broken).toEqual([]);
  }, 120_000);
});
