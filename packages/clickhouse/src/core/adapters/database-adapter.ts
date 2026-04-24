import type { ClickHouseSettings } from '@clickhouse/client-common';

export interface QueryExecutionOptions {
  clickhouseSettings?: ClickHouseSettings;
  queryId?: string;
}

export interface DatabaseAdapter {
  readonly name: string;
  readonly namespace?: string;
  query<T>(sql: string, params?: unknown[], options?: QueryExecutionOptions): Promise<T[]>;
  stream?<T>(sql: string, params?: unknown[], options?: QueryExecutionOptions): Promise<ReadableStream<T[]>>;
  render?(sql: string, params?: unknown[]): string;
}
