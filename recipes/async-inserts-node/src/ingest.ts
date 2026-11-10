import { db } from './client.js';
import { TABLE } from './schema.js';

/** One row as sent: UInt64 as a string, DateTime as Unix seconds. */
export interface Row {
  event_id: string;
  tenant_id: number;
  user_id: number;
  event_type: string;
  occurred_at: number;
}

/** 1. One INSERT per row: one part per row. The pattern to avoid. */
export async function insertPerRow(rows: Row[]): Promise<void> {
  for (const row of rows) {
    await db.insert(TABLE).values(row).execute();
  }
}

/** 2. Buffer in the app and send one INSERT per batch: one part per batch. */
export async function insertBatched(rows: Row[], batchSize: number): Promise<void> {
  for (let i = 0; i < rows.length; i += batchSize) {
    await db.insert(TABLE).values(rows.slice(i, i + batchSize)).execute();
  }
}

/**
 * Server-side batching settings. The adaptive timeout is switched off so the
 * flush interval is a fixed 500 ms and the part count is reproducible; in
 * production the default adaptive 50-200 ms is usually right.
 */
export const ASYNC = {
  async_insert: 1,
  async_insert_use_adaptive_busy_timeout: 0,
  async_insert_busy_timeout_ms: 500,
} as const;

/**
 * 3. async_insert = 1, wait_for_async_insert = 1: every row is its own
 * INSERT, the server buffers them and writes one part per flush, and each
 * call resolves only once its row is in a part. Throughput comes from
 * concurrency: `concurrency` inserts in flight share one flush.
 */
export async function insertAsyncWait(rows: Row[], concurrency: number): Promise<void> {
  for (let i = 0; i < rows.length; i += concurrency) {
    await Promise.all(
      rows.slice(i, i + concurrency).map((row) =>
        db.insert(TABLE).values(row).settings({ ...ASYNC, wait_for_async_insert: 1 }).execute(),
      ),
    );
  }
}

/**
 * 4. async_insert = 1, wait_for_async_insert = 0: fire and forget. Each call
 * returns once the server has queued the row, before it is written, so a
 * server crash or a bad row is never reported back to the caller.
 */
export async function insertAsyncNoWait(rows: Row[], busyTimeoutMs = 60_000): Promise<void> {
  for (const row of rows) {
    await db
      .insert(TABLE)
      .values(row)
      .settings({ ...ASYNC, async_insert_busy_timeout_ms: busyTimeoutMs, wait_for_async_insert: 0 })
      .execute();
  }
}

/** The same 1,000 synthetic rows for every strategy. */
export function makeRows(n = 1000): Row[] {
  const start = Date.UTC(2026, 10, 1) / 1000;
  return Array.from({ length: n }, (_, i) => ({
    event_id: String(i + 1),
    tenant_id: 1 + (i % 5),
    user_id: 100 + (i % 37),
    event_type: ['page_view', 'api_call', 'query_run'][i % 3],
    occurred_at: start + i,
  }));
}
