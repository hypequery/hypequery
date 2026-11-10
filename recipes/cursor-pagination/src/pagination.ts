import { db } from './client.js';
import type { Schema } from './schema.js';

export type EventsTable = keyof Schema;

/** The last row of a page: where the next page starts. Opaque to the client. */
export interface Cursor {
  occurredAt: string;
  /** UInt64 arrives as a string from the JSON API; keep it one. */
  eventId: string;
}

export const encodeCursor = (c: Cursor) => Buffer.from(JSON.stringify(c)).toString('base64url');
export const decodeCursor = (s: string): Cursor => JSON.parse(Buffer.from(s, 'base64url').toString('utf8'));

const COLUMNS = ['event_id', 'occurred_at', 'event_type', 'user_id', 'path'] as const;

/**
 * Keyset ("cursor") pagination, newest first: rows strictly before the
 * cursor in (occurred_at, event_id) order. The condition is spelled out as
 * `occurred_at < t OR (occurred_at = t AND event_id < id)` rather than the
 * tuple `(occurred_at, event_id) < (t, id)`: ClickHouse 25.8 uses the
 * expanded form for partition pruning and the primary key, and the tuple
 * form for neither.
 */
export function keysetPageQuery(tenantId: number, pageSize: number, after: Cursor | null, table: EventsTable = 'events') {
  let query = db
    .table(table)
    .select([...COLUMNS])
    .where('tenant_id', 'eq', tenantId);
  if (after) {
    query = query.whereGroup((q) => {
      q.where('occurred_at', 'lt', after.occurredAt).orWhereGroup((tie) => {
        tie.where('occurred_at', 'eq', after.occurredAt).where('event_id', 'lt', after.eventId);
      });
    });
  }
  return query.orderBy('occurred_at', 'DESC').orderBy('event_id', 'DESC').limit(pageSize);
}

export async function keysetPage(tenantId: number, pageSize: number, after: string | null) {
  const rows = await keysetPageQuery(tenantId, pageSize, after ? decodeCursor(after) : null).execute();
  const last = rows.at(-1);
  return {
    rows,
    // A short page is the last one, so no cursor; a full page may still be
    // the last, and the next call then returns zero rows.
    nextCursor: rows.length === pageSize && last ? encodeCursor({ occurredAt: String(last.occurred_at), eventId: String(last.event_id) }) : null,
  };
}

/** LIMIT/OFFSET, for comparison: ClickHouse reads and discards every skipped row. */
export function offsetPageQuery(tenantId: number, pageSize: number, page: number, table: EventsTable = 'events') {
  return db
    .table(table)
    .select([...COLUMNS])
    .where('tenant_id', 'eq', tenantId)
    .orderBy('occurred_at', 'DESC')
    .orderBy('event_id', 'DESC')
    .limit(pageSize)
    .offset(page * pageSize);
}
