import type { ClickHouseSettings, ClickHouseSummary } from '@clickhouse/client-common';

export interface QueryExecutionOptions {
  clickhouseSettings?: ClickHouseSettings;
  queryId?: string;
}

export interface InsertExecutionOptions {
  clickhouseSettings?: ClickHouseSettings;
  queryId?: string;
  /** Explicit column subset; adapters must preserve it so omitted columns take table DEFAULTs. */
  columns?: string[];
}

export interface InsertResultSummary {
  /** Empty when no request was sent or the backing engine does not provide query IDs. */
  queryId: string;
  executed: boolean;
  /** Server-side insert summary when the client provides one (e.g. written_rows). */
  summary?: ClickHouseSummary;
}

export interface DatabaseAdapter {
  readonly name: string;
  readonly namespace?: string;
  query<T>(sql: string, params?: unknown[], options?: QueryExecutionOptions): Promise<T[]>;
  stream?<T>(sql: string, params?: unknown[], options?: QueryExecutionOptions): Promise<ReadableStream<T[]>>;
  /**
   * Inserts rows that have already been normalized for JSONEachRow-compatible
   * execution. The executor filters explicit empty batches before calling the
   * adapter. When `options.columns` is present, omitted table columns must be
   * left for the engine to fill via DEFAULT or Nullable semantics.
   */
  insert?<T extends Record<string, unknown>>(
    table: string,
    rows: T[],
    options?: InsertExecutionOptions
  ): Promise<InsertResultSummary>;
  render?(sql: string, params?: unknown[]): string;
}
