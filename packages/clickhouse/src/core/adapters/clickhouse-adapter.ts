import type { DatabaseAdapter } from './database-adapter.js';
import type { ClickHouseClient as NodeClickHouseClient } from '@clickhouse/client';
import type { ClickHouseClient as WebClickHouseClient } from '@clickhouse/client-web';
import type { ClickHouseConfig } from '../query-builder.js';
import { isClientConfig } from '../query-builder.js';
import { substituteParameters } from '../utils.js';
import { createJsonEachRowStream } from '../utils/streaming-helpers.js';
import { getAutoClientModule } from '../env/auto-client.js';
import type { AutoClientModule } from '../env/auto-client.js';

type ClickHouseClient = NodeClickHouseClient | WebClickHouseClient;

function createClickHouseClient(config: ClickHouseConfig): ClickHouseClient {
  if (isClientConfig(config)) {
    return config.client;
  }
  const clientModule: AutoClientModule = getAutoClientModule();
  return clientModule.createClient(config);
}

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
  private client: ClickHouseClient;

  constructor(private config: ClickHouseConfig) {
    this.namespace = deriveNamespace(config);
    this.client = createClickHouseClient(config);
  }

  async query<T>(sql: string, params: unknown[] = []): Promise<T[]> {
    const finalSQL = substituteParameters(sql, params);
    const result = await this.client.query({
      query: finalSQL,
      format: 'JSONEachRow'
    });
    return result.json<T>();
  }

  async stream<T>(sql: string, params: unknown[] = []): Promise<ReadableStream<T[]>> {
    const finalSQL = substituteParameters(sql, params);
    const result = await this.client.query({
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
