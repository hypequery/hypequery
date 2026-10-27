import type { PostgresDriver, PostgresQueryOptions } from './driver.js';
import { resultValueTypes } from './result-values.js';
import { toGuardError } from '../dialect/guard-errors.js';
import { pinnedSearchPath } from '../utils/search-path.js';

/** The subset of a node-postgres `PoolClient` the driver uses. */
export interface PgClientLike {
  query(config: {
    text: string;
    values?: unknown[];
    types?: typeof resultValueTypes;
    queryMode?: 'extended';
  }): Promise<{ rows: unknown[] }>;
  query(text: string, values?: unknown[]): Promise<{ rows: unknown[] }>;
  release(error?: Error | boolean): void;
  readonly processID?: number | null;
}

/** The subset of a node-postgres `Pool` the driver uses. */
export interface PgPoolLike {
  connect(): Promise<PgClientLike>;
}

export interface PgDriverOptions {
  /** A node-postgres `Pool` (or anything with its `connect()`). */
  readonly pool: PgPoolLike;
  /**
   * Server-side `statement_timeout` for every query, in milliseconds.
   * Defaults to 30 seconds; `0` disables it. Protects OLTP primaries.
   */
  readonly statementTimeoutMs?: number;
  /**
   * Run each query in a `READ ONLY` transaction (default `true`), so a raw
   * `sql` field can never write even if it slipped past validation.
   */
  readonly readOnly?: boolean;
  /**
   * The most rows one query may return (default 100,000). A larger result is
   * refused rather than buffered: the statement runs through a server-side
   * cursor and stops one row past the ceiling.
   */
  readonly maxRows?: number;
  /**
   * Pin `search_path` for every query to these schemas, ignoring the role's or
   * connection's own setting. `pg_catalog` is always searched first and
   * `pg_temp` last; list only schemas untrusted roles can't create objects in.
   * Unset, unqualified names resolve through the session's `search_path`.
   */
  readonly searchPath?: readonly string[];
}

const DEFAULT_STATEMENT_TIMEOUT_MS = 30_000;
const DEFAULT_MAX_ROWS = 100_000;
const CURSOR = '_hq_rows';

/**
 * Adapt a node-postgres pool. Each query runs in its own short transaction
 * that pins the session settings hypequery's SQL relies on: UTC session time
 * zone, standard-conforming strings and a statement timeout. Statements use
 * the extended protocol, which refuses more than one statement per call.
 * No setting outlives its transaction, as a transaction-mode pooler such as
 * PgBouncer requires.
 */
export function createPgDriver(options: PgDriverOptions): PostgresDriver {
  const timeout = options.statementTimeoutMs ?? DEFAULT_STATEMENT_TIMEOUT_MS;
  if (!Number.isSafeInteger(timeout) || timeout < 0) {
    throw new Error('statementTimeoutMs must be a non-negative integer.');
  }
  const maxRows = options.maxRows ?? DEFAULT_MAX_ROWS;
  if (!Number.isSafeInteger(maxRows) || maxRows < 1) {
    throw new Error('maxRows must be a positive integer.');
  }
  const begin = [
    options.readOnly === false ? 'BEGIN' : 'BEGIN READ ONLY',
    `SET LOCAL statement_timeout = ${timeout}`,
    "SET LOCAL TimeZone = 'UTC'",
    'SET LOCAL standard_conforming_strings = on',
    ...(options.searchPath ? [`SET LOCAL search_path = ${pinnedSearchPath(options.searchPath)}`] : []),
  ].join('; ');

  return {
    async query<T>(sql: string, parameters: readonly unknown[], queryOptions: PostgresQueryOptions = {}): Promise<T[]> {
      const { abortSignal } = queryOptions;
      abortSignal?.throwIfAborted();
      const client = await options.pool.connect();
      let releaseError: Error | undefined;
      const cancel = () => { void cancelBackend(options.pool, client.processID); };
      try {
        await client.query(begin);
        abortSignal?.addEventListener('abort', cancel, { once: true });
        abortSignal?.throwIfAborted();
        // A cursor admits exactly one SELECT or VALUES and lets the server stop
        // one row past the ceiling instead of sending the whole result.
        await client.query({
          text: `DECLARE ${CURSOR} NO SCROLL CURSOR FOR ${sql}`,
          values: [...parameters],
          queryMode: 'extended',
        });
        const result = await client.query({ text: `FETCH FORWARD ${maxRows + 1} FROM ${CURSOR}`, types: resultValueTypes });
        await client.query('COMMIT');
        if (result.rows.length > maxRows) {
          throw new Error(`The query result is too large: it exceeds ${maxRows} rows.`);
        }
        return result.rows as T[];
      } catch (error) {
        try {
          await client.query('ROLLBACK');
        } catch (rollbackError) {
          // A connection that cannot roll back must not return to the pool.
          releaseError = rollbackError instanceof Error ? rollbackError : new Error(String(rollbackError));
        }
        if (abortSignal?.aborted) throw abortSignal.reason ?? error;
        throw toGuardError(error);
      } finally {
        abortSignal?.removeEventListener('abort', cancel);
        client.release(releaseError);
      }
    },
  };
}

/** Ask the server to cancel the backend running a statement; best effort. */
async function cancelBackend(pool: PgPoolLike, processID: number | null | undefined): Promise<void> {
  if (typeof processID !== 'number') return;
  let client: PgClientLike | undefined;
  try {
    client = await pool.connect();
    await client.query('SELECT pg_cancel_backend($1)', [processID]);
  } catch {
    // The statement may already have finished; its own error path reports.
  } finally {
    client?.release();
  }
}
