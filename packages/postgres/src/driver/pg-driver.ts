import type { PostgresDriver, PostgresQueryOptions } from './driver.js';
import { resultValueTypes } from './result-values.js';

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
}

const DEFAULT_STATEMENT_TIMEOUT_MS = 30_000;

/**
 * Adapt a node-postgres pool. Each query runs in its own short transaction
 * that pins the session settings hypequery's SQL relies on: UTC session time
 * zone, standard-conforming strings and a statement timeout. Statements use
 * the extended protocol, which refuses more than one statement per call.
 */
export function createPgDriver(options: PgDriverOptions): PostgresDriver {
  const timeout = options.statementTimeoutMs ?? DEFAULT_STATEMENT_TIMEOUT_MS;
  if (!Number.isSafeInteger(timeout) || timeout < 0) {
    throw new Error('statementTimeoutMs must be a non-negative integer.');
  }
  const begin = [
    options.readOnly === false ? 'BEGIN' : 'BEGIN READ ONLY',
    `SET LOCAL statement_timeout = ${timeout}`,
    "SET LOCAL TimeZone = 'UTC'",
    'SET LOCAL standard_conforming_strings = on',
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
        const result = await client.query({
          text: sql,
          values: [...parameters],
          types: resultValueTypes,
          queryMode: 'extended',
        });
        await client.query('COMMIT');
        return result.rows as T[];
      } catch (error) {
        try {
          await client.query('ROLLBACK');
        } catch (rollbackError) {
          // A connection that cannot roll back must not return to the pool.
          releaseError = rollbackError instanceof Error ? rollbackError : new Error(String(rollbackError));
        }
        if (abortSignal?.aborted) throw abortSignal.reason ?? error;
        throw error;
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
