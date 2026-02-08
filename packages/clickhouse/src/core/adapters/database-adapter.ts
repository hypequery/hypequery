export interface DatabaseAdapter {
  readonly name: string;
  readonly namespace?: string;
  query<T>(sql: string, params?: unknown[]): Promise<T[]>;
  stream?<T>(sql: string, params?: unknown[]): Promise<ReadableStream<T[]>>;
  render?(sql: string, params?: unknown[]): string;
}
