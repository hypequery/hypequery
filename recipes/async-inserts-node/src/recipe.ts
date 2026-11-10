import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { CONCURRENCY, db } from './client.js';
import { ASYNC, insertAsyncNoWait, insertAsyncWait, insertBatched, insertPerRow, makeRows } from './ingest.js';
import { TABLE } from './schema.js';
import { command, dropTable, flushAsyncInserts, resetTable, tableState } from './table.js';

export const ROWS = 1000;
export const BATCH_SIZE = 250;

export interface StrategyResult {
  strategy: string;
  inserts: number;
  parts: number;
  rows: number;
  /** Rows visible when the last insert call returned (before any manual flush). */
  rowsWhenCallsReturned: number;
  ms: number;
}

async function measure(strategy: string, inserts: number, ingest: () => Promise<void>, flush = false): Promise<StrategyResult> {
  await resetTable();
  const started = performance.now();
  await ingest();
  const ms = Math.round(performance.now() - started);
  const whenReturned = await tableState();
  if (flush) await flushAsyncInserts();
  const { parts, rows } = await tableState();
  return { strategy, inserts, parts, rows, rowsWhenCallsReturned: whenReturned.rows, ms };
}

/** Ingest the same 1,000 rows four ways and count the parts each creates. */
export async function run(): Promise<StrategyResult[]> {
  const rows = makeRows(ROWS);
  try {
    return [
      await measure('per-row INSERT', ROWS, () => insertPerRow(rows)),
      await measure(`client batches of ${BATCH_SIZE}`, ROWS / BATCH_SIZE, () => insertBatched(rows, BATCH_SIZE)),
      await measure(`async_insert, wait=1, ${CONCURRENCY} in flight`, ROWS, () => insertAsyncWait(rows, CONCURRENCY)),
      await measure('async_insert, wait=0, then flush', ROWS, () => insertAsyncNoWait(rows), true),
    ];
  } finally {
    await dropTable();
  }
}

/** What is pinned: everything except the timings. */
export const pinned = (results: StrategyResult[]) => results.map(({ ms: _ms, ...rest }) => rest);

/**
 * The statement hypequery sends for an insert, read back from
 * system.query_log: rows travel in the request body as JSONEachRow, and
 * settings such as async_insert travel as HTTP parameters, not in the SQL.
 */
export async function sentSQL(): Promise<{ query: string; asyncInsert: string; writtenRows: string }> {
  await resetTable();
  try {
    const queryId = randomUUID();
    const result = await db.insert(TABLE).values(makeRows(1)).settings({ ...ASYNC, wait_for_async_insert: 1 }).execute({ queryId });
    await command('SYSTEM FLUSH LOGS');
    const [row] = await db.rawQuery<{ query: string; async_insert: string }>(
      `SELECT query, Settings['async_insert'] AS async_insert FROM system.query_log WHERE query_id = ? AND type = 'QueryFinish'`,
      [queryId],
    );
    return { query: row.query.trim(), asyncInsert: row.async_insert, writtenRows: String(result.summary?.written_rows) };
  } finally {
    await dropTable();
  }
}

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const isMain = process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href;
if (isMain) {
  run()
    .then(async (results) => {
      if (process.argv.includes('--write')) {
        fs.writeFileSync(path.join(root, 'expected.sql'), `${(await sentSQL()).query}\n`);
        fs.writeFileSync(path.join(root, 'output.json'), `${JSON.stringify(pinned(results), null, 2)}\n`);
        console.log('wrote expected.sql and output.json');
      } else if (process.argv.includes('--json')) {
        console.log(JSON.stringify(results, null, 2));
      } else {
        console.log(`${ROWS} rows into a MergeTree table, four ways (merges stopped, so parts = parts created)\n`);
        console.table(results);
      }
      await db.close();
    })
    .catch(async (error) => {
      console.error(error instanceof Error ? error.message : error);
      await db.close();
      process.exit(1);
    });
}
