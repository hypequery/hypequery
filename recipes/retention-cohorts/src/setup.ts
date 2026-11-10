import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createClient } from '@clickhouse/client';
import { connection } from './client.js';

const sqlFile = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'sql', 'cohort-activity.sql');

/** Create (or replace) the cohort view. Idempotent. */
export async function setup(): Promise<void> {
  const client = createClient(connection);
  try {
    await client.command({ query: fs.readFileSync(sqlFile, 'utf8') });
  } finally {
    await client.close();
  }
}

const isMain = process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href;
if (isMain) {
  setup()
    .then(() => console.log('created view user_cohort_activity'))
    .catch((error) => {
      console.error(error instanceof Error ? error.message : error);
      process.exit(1);
    });
}
