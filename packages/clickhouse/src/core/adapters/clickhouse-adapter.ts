import type { DatabaseAdapter } from './database-adapter.js';
import type { ClickHouseConfig } from '../query-builder.js';
import { ClickHouseConnection } from '../connection.js';
import { substituteParameters } from '../utils.js';
import { createJsonEachRowStream } from '../utils/streaming-helpers.js';

function deriveNamespace(config: ClickHouseConfig): string {
  if ('client' in config && config.client) {
    return 'client';
  }
  const host = 'host' in config ? config.host : 'unknown-host';
  const database = 'database' in config ? config.database : 'default';
  const username = 'username' in config ? config.username : 'default';
  return `${host || 'unknown-host'}|${database || 'default'}|${username || 'default'}`;
}

export class ClickHouseAdapter implements DatabaseAdapter {
  readonly name = 'clickhouse';
  readonly namespace?: string;

  constructor(private config: ClickHouseConfig) {
    this.namespace = deriveNamespace(config);
    ClickHouseConnection.initialize(config);
  }

  async query<T>(sql: string, params: unknown[] = []): Promise<T[]> {
    const client = ClickHouseConnection.getClient();
    const finalSQL = substituteParameters(sql, params);
    const result = await client.query({
      query: finalSQL,
      format: 'JSONEachRow'
    });
    return result.json<T>();
  }

  async stream<T>(sql: string, params: unknown[] = []): Promise<ReadableStream<T[]>> {
    const client = ClickHouseConnection.getClient();
    const finalSQL = substituteParameters(sql, params);
    const result = await client.query({
      query: finalSQL,
      format: 'JSONEachRow'
    });
    const stream = result.stream();
    return createJsonEachRowStream<T>(stream as NodeJS.ReadableStream);
  }

  render(sql: string, params: unknown[] = []): string {
    return substituteParameters(sql, params);
  }
}

export function createClickHouseAdapter(config: ClickHouseConfig): DatabaseAdapter {
  return new ClickHouseAdapter(config);
}
