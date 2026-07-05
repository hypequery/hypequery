import type { ClickHouseSettings } from '@clickhouse/client-common';

export interface QueryExecutionOptions {
  clickhouseSettings?: ClickHouseSettings;
  queryId?: string;
}

export interface InsertExecutionOptions {
  clickhouseSettings?: ClickHouseSettings;
  queryId?: string;
  /** Explicit column subset; omitted columns take table DEFAULTs. */
  columns?: string[];
}

export interface InsertResultSummary {
  queryId: string;
  executed: boolean;
  /** Server-side insert summary when the client provides one (e.g. written_rows). */
  summary?: unknown;
}

export interface DatabaseAdapter {
  readonly name: string;
  readonly namespace?: string;
  query<T>(sql: string, params?: unknown[], options?: QueryExecutionOptions): Promise<T[]>;
  stream?<T>(sql: string, params?: unknown[], options?: QueryExecutionOptions): Promise<ReadableStream<T[]>>;
  insert?<T extends Record<string, unknown>>(
    table: string,
    rows: T[],
    options?: InsertExecutionOptions
  ): Promise<InsertResultSummary>;
  render?(sql: string, params?: unknown[]): string;
}
