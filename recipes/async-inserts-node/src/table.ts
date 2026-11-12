import { createClient } from '@clickhouse/client';
import { connection, db } from './client.js';
import { CREATE_TABLE, TABLE } from './schema.js';

export async function command(query: string): Promise<void> {
  const client = createClient(connection);
  try {
    await client.command({ query });
  } finally {
    await client.close();
  }
}

/** Create the table, stop background merges on it, and empty it. Idempotent. */
export async function resetTable(): Promise<void> {
  await command(CREATE_TABLE);
  await command(`SYSTEM STOP MERGES ${TABLE}`);
  await command(`TRUNCATE TABLE ${TABLE}`);
}

export async function dropTable(): Promise<void> {
  await command(`DROP TABLE IF EXISTS ${TABLE}`);
}

/** Write out every buffered async insert now instead of waiting for the timeout. */
export async function flushAsyncInserts(): Promise<void> {
  await command('SYSTEM FLUSH ASYNC INSERT QUEUE');
}

/** Active parts and rows in the table. With merges stopped, parts = parts created. */
export async function tableState(): Promise<{ parts: number; rows: number }> {
  const [row] = await db.rawQuery<{ parts: string; rows: string }>(
    `SELECT count() AS parts, sum(rows) AS rows FROM system.parts
     WHERE database = currentDatabase() AND table = ? AND active`,
    [TABLE],
  );
  return { parts: Number(row.parts), rows: Number(row.rows) };
}
