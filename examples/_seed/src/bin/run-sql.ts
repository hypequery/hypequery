#!/usr/bin/env node
/**
 * Run one or more .sql files against the seed database, statement by
 * statement. Used by the examples CI workflow to prove that every SQL block in
 * guides/ still runs on the pinned ClickHouse + seed.
 *
 *   node dist/bin/run-sql.js guides/refreshable-materialized-views/*.sql
 */
import fs from 'node:fs';
import { configFromEnv } from '../config.js';
import { createSeedClient } from '../client.js';
import { splitSqlStatements } from '../utils/sql-statements.js';

const files = process.argv.slice(2).filter((arg) => !arg.startsWith('--'));
if (files.length === 0) {
  console.log('run-sql: no files given, nothing to do.');
  process.exit(0);
}

const config = configFromEnv();
const client = createSeedClient(config);
const isResultSet = (statement: string) => /^\s*(select|with|show|describe|desc|explain|exists)\b/i.test(statement);

let failures = 0;
for (const file of files) {
  const statements = splitSqlStatements(fs.readFileSync(file, 'utf8'));
  console.log(`${file}: ${statements.length} statement${statements.length === 1 ? '' : 's'}`);
  for (const [index, statement] of statements.entries()) {
    const label = `  [${index + 1}/${statements.length}] ${statement.split('\n')[0].slice(0, 80)}`;
    try {
      if (isResultSet(statement)) {
        const rs = await client.query({ query: statement, format: 'JSONEachRow' });
        const rows = await rs.json<unknown[]>();
        console.log(`${label} -> ${rows.length} row${rows.length === 1 ? '' : 's'}`);
      } else {
        await client.command({ query: statement });
        console.log(`${label} -> ok`);
      }
    } catch (error) {
      failures += 1;
      console.error(`${label} -> FAILED`);
      console.error(`    ${error instanceof Error ? error.message.split('\n')[0] : String(error)}`);
    }
  }
}
await client.close();

if (failures > 0) {
  console.error(`\nrun-sql: ${failures} statement${failures === 1 ? '' : 's'} failed.`);
  process.exit(1);
}
console.log('\nrun-sql: all statements ran.');
