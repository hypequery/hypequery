import { createClient } from '@clickhouse/client';
import { connection } from './client.js';
import { runSqlFile } from './sql-file.js';

/**
 * Create both rollups over the seed's `events` table:
 *  1. the incremental view + AggregatingMergeTree target, backfilled;
 *  2. the refreshable view + its target, refreshed once so it is queryable.
 * Idempotent: every statement is IF NOT EXISTS, and the backfill truncates.
 */
export async function setup(log: (line: string) => void = () => {}): Promise<void> {
  const client = createClient(connection);
  try {
    log(`incremental: ${await runSqlFile(client, '01-incremental.sql')} statements`);
    log(`refreshable: ${await runSqlFile(client, '02-refreshable.sql')} statements`);
    // The first refresh starts as soon as the view exists; wait for it.
    await client.command({ query: 'SYSTEM REFRESH VIEW tenant_daily_summary_rmv' });
    await client.command({ query: 'SYSTEM WAIT VIEW tenant_daily_summary_rmv' });
    log('refreshable: first refresh complete');
  } finally {
    await client.close();
  }
}

const isMain = process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href;
if (isMain) {
  setup((line) => console.log(line)).catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
}
