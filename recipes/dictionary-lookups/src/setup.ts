import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createClient } from '@clickhouse/client';
import { connection } from './client.js';

const sqlDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'sql');

/** A value inside a single-quoted ClickHouse string literal. */
const quote = (value: string) => value.replace(/\\/g, '\\\\').replace(/'/g, "\\'");

/** Statements in a .sql file, comments stripped, `{name}` filled in, split on a trailing `;`. */
export function statements(file: string, vars: Record<string, string> = {}): string[] {
  return fs
    .readFileSync(path.join(sqlDir, file), 'utf8')
    .split('\n')
    .filter((line) => !line.trimStart().startsWith('--'))
    .join('\n')
    .replace(/\{(\w+)\}/g, (match, name: string) => (name in vars ? quote(vars[name]) : match))
    .split(/;\s*(?:\n|$)/)
    .map((s) => s.trim())
    .filter(Boolean);
}

async function runFile(file: string): Promise<void> {
  const client = createClient(connection);
  const vars = { database: connection.database, user: connection.username, password: connection.password };
  try {
    for (const query of statements(file, vars)) await client.command({ query });
  } finally {
    await client.close();
  }
}

/** Recreate the tenants copy and the dictionary over it, loaded. Idempotent; never touches the seed tables. */
export const setup = () => runFile('setup.sql');

/** Drop everything setup created. */
export const teardown = () => runFile('teardown.sql');

const isMain = process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href;
if (isMain) {
  const drop = process.argv.includes('--teardown');
  (drop ? teardown() : setup())
    .then(() => console.log(drop ? 'dropped dictionary_lookups_*' : 'created dictionary dictionary_lookups_tenants over dictionary_lookups_tenants_source'))
    .catch((error) => {
      console.error(error instanceof Error ? error.message : error);
      process.exit(1);
    });
}
