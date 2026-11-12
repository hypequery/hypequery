import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createClient } from '@clickhouse/client';
import { connection } from './client.js';

const sqlDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'sql');

/** The seed's "today": its events end on 2026-10-31. Retention is measured from here. */
export const SEED_TODAY = '2026-11-01';

/** Statements in a .sql file, comments stripped, split on a trailing `;`. */
export function statements(file: string, vars: Record<string, string | number> = {}): string[] {
  return fs
    .readFileSync(path.join(sqlDir, file), 'utf8')
    .split('\n')
    .filter((line) => !line.trimStart().startsWith('--'))
    .join('\n')
    .replace(/\{(\w+)\}/g, (match, name: string) => (name in vars ? String(vars[name]) : match))
    .split(/;\s*(?:\n|$)/)
    .map((s) => s.trim())
    .filter(Boolean);
}

async function runFile(file: string): Promise<void> {
  const client = createClient(connection);
  try {
    // Days from the seed's today to the server's today. TTL is evaluated
    // against the server clock, so ask the server, not this machine.
    const result = await client.query({
      query: `SELECT dateDiff('day', toDate({seedToday:String}), today()) AS days`,
      query_params: { seedToday: SEED_TODAY },
      format: 'JSONEachRow',
    });
    const [{ days }] = await result.json<{ days: number }>();
    for (const query of statements(file, { seed_age_days: days })) await client.command({ query });
  } finally {
    await client.close();
  }
}

/** Recreate the events copy (merges held) with per-plan table TTL and a column TTL. Idempotent. */
export const setup = () => runFile('setup.sql');

/** Start merges and run ALTER TABLE ... MATERIALIZE TTL. */
export const materialize = () => runFile('materialize.sql');

/** Drop everything setup created. */
export const teardown = () => runFile('teardown.sql');

const isMain = process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href;
if (isMain) {
  const drop = process.argv.includes('--teardown');
  (drop ? teardown() : setup())
    .then(() => console.log(drop ? 'dropped ttl_data_retention_events' : 'created ttl_data_retention_events with TTL rules (not yet materialized)'))
    .catch((error) => {
      console.error(error instanceof Error ? error.message : error);
      process.exit(1);
    });
}
