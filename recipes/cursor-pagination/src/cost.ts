import { randomUUID } from 'node:crypto';
import { createClient } from '@clickhouse/client';
import { connection, db } from './client.js';
import { keysetPageQuery, offsetPageQuery } from './pagination.js';

export const COPY = 'cursor_pagination_events';

/**
 * The seed's `events` is a million rows in about 60 small parts with
 * 8,192-row granules: too coarse for index skipping to show, and the layout
 * changes as background merges run. Measurements use a copy with 1,024-row
 * granules and one part per month, so they are the same on every machine.
 * Same rows, same sort key. Idempotent.
 */
export async function createCopy(): Promise<void> {
  const client = createClient(connection);
  try {
    await client.command({
      query: `CREATE TABLE IF NOT EXISTS ${COPY} (
        event_id UInt64, tenant_id UInt32, user_id UInt32, event_type LowCardinality(String), path String,
        status_code UInt16, latency_ms UInt32, device LowCardinality(String), occurred_at DateTime('UTC'))
      ENGINE = MergeTree PARTITION BY toYYYYMM(occurred_at) ORDER BY (tenant_id, occurred_at, event_id)
      SETTINGS index_granularity = 1024`,
    });
    const [state] = await db.rawQuery<{ rows: string; parts: string }>(
      `SELECT (SELECT count() FROM ${COPY}) AS rows,
              (SELECT count() FROM system.parts WHERE database = currentDatabase() AND table = '${COPY}' AND active) AS parts`,
    );
    if (Number(state.rows) !== 1_000_000 || Number(state.parts) !== 12) {
      await client.command({ query: `TRUNCATE TABLE ${COPY}` });
      await client.command({ query: `INSERT INTO ${COPY} SELECT * FROM events` });
      await client.command({ query: `OPTIMIZE TABLE ${COPY} FINAL` });
    }
  } finally {
    await client.close();
  }
}

export async function dropCopy(): Promise<void> {
  const client = createClient(connection);
  try {
    await client.command({ query: `DROP TABLE IF EXISTS ${COPY}` });
  } finally {
    await client.close();
  }
}

/** Granules the primary key leaves to read, from EXPLAIN indexes = 1. Deterministic. */
export async function granules(sql: string): Promise<{ selected: number; total: number }> {
  const plan = await db.rawQuery<{ explain: string }>(`EXPLAIN indexes = 1 ${sql}`);
  const lines = plan.map((r) => r.explain.trim());
  const pk = lines.findIndex((l) => l === 'PrimaryKey');
  const line = lines.slice(pk).find((l) => l.startsWith('Granules:'))!;
  const [selected, total] = line.replace('Granules: ', '').split('/').map(Number);
  return { selected, total };
}

/** Rows the server actually read, from system.query_log. Varies a little with max_threads. */
export async function readRows(run: (queryId: string) => Promise<unknown>): Promise<number> {
  const queryId = randomUUID();
  await run(queryId);
  const client = createClient(connection);
  try {
    await client.command({ query: 'SYSTEM FLUSH LOGS' });
  } finally {
    await client.close();
  }
  const [row] = await db.rawQuery<{ read_rows: string }>(
    `SELECT read_rows FROM system.query_log WHERE query_id = ? AND type = 'QueryFinish' ORDER BY event_time DESC LIMIT 1`,
    [queryId],
  );
  return Number(row.read_rows);
}

export interface CostRow {
  page: number;
  offsetGranules: number;
  keysetGranules: number;
  offsetReadRows: number;
  keysetReadRows: number;
}

/** OFFSET vs keyset at increasing depth, over the compacted copy. */
export async function compareCost(tenantId: number, pageSize: number, pages: number[]): Promise<CostRow[]> {
  const out: CostRow[] = [];
  for (const page of pages) {
    const offsetQuery = offsetPageQuery(tenantId, pageSize, page, COPY);
    // The cursor for page N is the last row of page N - 1.
    const [last] = page === 0 ? [] : await db.table(COPY).select(['occurred_at', 'event_id']).where('tenant_id', 'eq', tenantId)
      .orderBy('occurred_at', 'DESC').orderBy('event_id', 'DESC').limit(1).offset(page * pageSize - 1).execute();
    const keysetQuery = keysetPageQuery(tenantId, pageSize, last ? { occurredAt: String(last.occurred_at), eventId: String(last.event_id) } : null, COPY);
    out.push({
      page: page + 1,
      offsetGranules: (await granules(offsetQuery.toSQL())).selected,
      keysetGranules: (await granules(keysetQuery.toSQL())).selected,
      offsetReadRows: await readRows((queryId) => offsetQuery.execute({ queryId })),
      keysetReadRows: await readRows((queryId) => keysetQuery.execute({ queryId })),
    });
  }
  return out;
}
