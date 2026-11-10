import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createClient } from '@clickhouse/client';
import { connection } from './client.js';

const sqlFile = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'sql', 'user-funnel.sql');

export const VIEW = 'funnel_windowfunnel_user_levels';

/** Create (or replace) the per-user funnel view. Idempotent. */
export async function setup(): Promise<void> {
  const client = createClient(connection);
  try {
    await client.command({ query: fs.readFileSync(sqlFile, 'utf8') });
  } finally {
    await client.close();
  }
}

/** Drop the view again; the smoke test calls this so a shared database is left as it was. */
export async function teardown(): Promise<void> {
  const client = createClient(connection);
  try {
    await client.command({ query: `DROP VIEW IF EXISTS ${VIEW}` });
  } finally {
    await client.close();
  }
}

const isMain = process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href;
if (isMain) {
  setup()
    .then(() => console.log(`created view ${VIEW}`))
    .catch((error) => {
      console.error(error instanceof Error ? error.message : error);
      process.exit(1);
    });
}
