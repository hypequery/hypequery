import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createClient } from '@clickhouse/client';
import { connection } from './client.js';

const sqlDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'sql');

/** Statements in a .sql file, comments stripped, split on a trailing `;`. */
export function statements(file: string): string[] {
  return fs
    .readFileSync(path.join(sqlDir, file), 'utf8')
    .split('\n')
    .filter((line) => !line.trimStart().startsWith('--'))
    .join('\n')
    .split(/;\s*(?:\n|$)/)
    .map((s) => s.trim())
    .filter(Boolean);
}

async function runFile(file: string): Promise<void> {
  const client = createClient(connection);
  try {
    for (const query of statements(file)) await client.command({ query });
  } finally {
    await client.close();
  }
}

/** Recreate the upsert table (merges held) and the argMax view. Idempotent; never touches the seed tables. */
export const setup = () => runFile('setup.sql');

/** Drop everything setup created. */
export const teardown = () => runFile('teardown.sql');

/** Start merges and run OPTIMIZE TABLE ... FINAL. */
export const optimize = () => runFile('optimize.sql');

const isMain = process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href;
if (isMain) {
  const drop = process.argv.includes('--teardown');
  (drop ? teardown() : setup())
    .then(() => console.log(drop ? 'dropped replacingmergetree_upserts_*' : 'created replacingmergetree_upserts_tenants (merges held) and replacingmergetree_upserts_tenants_latest'))
    .catch((error) => {
      console.error(error instanceof Error ? error.message : error);
      process.exit(1);
    });
}
