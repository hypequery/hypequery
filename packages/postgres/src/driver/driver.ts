export interface PostgresQueryOptions {
  /** Cancels the running statement on the server when aborted. */
  readonly abortSignal?: AbortSignal;
}

/**
 * The one thing hypequery needs from a Postgres client: run a single
 * parameterised statement (`$1`, `$2`, …) and return its rows. Implement it
 * over any client; {@link createPgDriver} adapts a node-postgres pool.
 *
 * Rows must follow the hypequery value contract so results match across
 * engines: 64-bit integers as strings, other numbers as numbers, `timestamp`
 * and `date` values as their wall-clock text (`YYYY-MM-DD HH:MM:SS`,
 * `YYYY-MM-DD`), `timestamptz` as UTC wall-clock text.
 */
export interface PostgresDriver {
  query<T = Record<string, unknown>>(
    sql: string,
    parameters: readonly unknown[],
    options?: PostgresQueryOptions,
  ): Promise<T[]>;
}
