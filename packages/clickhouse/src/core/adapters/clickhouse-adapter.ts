import type { DatabaseAdapter, QueryExecutionOptions } from './database-adapter.js';
import type { ClickHouseClient as NodeClickHouseClient } from '@clickhouse/client';
import type { ClickHouseClient as WebClickHouseClient } from '@clickhouse/client-web';
import type { ClickHouseConfig } from '../query-builder.js';
import { isClientConfig } from '../query-builder.js';
import { getConnectionEndpoint } from '../utils/connection-endpoint.js';
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
  const endpoint = getConnectionEndpoint(config);
  const database = 'database' in config ? config.database : 'default';
  const username = 'username' in config ? config.username : 'default';
  return `${endpoint || 'unknown-host'}|${database || 'default'}|${username || 'default'}`;
}

export class ClickHouseAdapter implements DatabaseAdapter {
  readonly name = 'clickhouse';
  readonly namespace?: string;
  private client: ClickHouseClient;

  constructor(private config: ClickHouseConfig) {
    this.namespace = deriveNamespace(config);
    this.client = createClickHouseClient(config);
  }

  /**
   * Builds a parameter map for ClickHouse native parameter binding.
   * Extracts parameter names from SQL placeholders like {param_0:Int64}
   * and maps them to their values.
   */
  private buildParameterMap(sql: string, params: unknown[]): Record<string, unknown> {
    if (params.length === 0) {
      return {};
    }

    const paramMap: Record<string, unknown> = {};
    const regex = /\{(\w+):[^}]+\}/g;
    let match;
    let index = 0;

    while ((match = regex.exec(sql)) !== null) {
      const paramName = match[1];
      if (index < params.length) {
        paramMap[paramName] = params[index++];
      }
    }

    return paramMap;
  }

  async query<T>(sql: string, params: unknown[] = [], options?: QueryExecutionOptions): Promise<T[]> {
    const paramMap = this.buildParameterMap(sql, params);
    const result = await this.client.query({
      query: sql,
      format: 'JSONEachRow',
      query_params: paramMap,
      clickhouse_settings: options?.clickhouseSettings,
      query_id: options?.queryId,
    });
    return result.json<T>();
  }

  async stream<T>(sql: string, params: unknown[] = [], options?: QueryExecutionOptions): Promise<ReadableStream<T[]>> {
    const paramMap = this.buildParameterMap(sql, params);
    const result = await this.client.query({
      query: sql,
      format: 'JSONEachRow',
      query_params: paramMap,
      clickhouse_settings: options?.clickhouseSettings,
      query_id: options?.queryId,
    });
    const stream = result.stream();
    return createJsonEachRowStream<T>(stream as NodeJS.ReadableStream);
  }

  render(sql: string, params: unknown[] = []): string {
    if (params.length === 0) {
      return sql;
    }

    // Replace {param_N:Type} placeholders with actual values for display
    let result = sql;
    let index = 0;
    const regex = /\{(\w+):[^}]+\}/g;

    result = result.replace(regex, () => {
      if (index >= params.length) {
        return '?';
      }
      const value = params[index++];

      // Format value for display (similar to old escapeValue logic)
      if (typeof value === 'boolean') {
        return value ? 'true' : 'false';
      } else if (typeof value === 'number') {
        return value.toString();
      } else if (typeof value === 'string') {
        const escaped = value.replace(/\\/g, '\\\\').replace(/'/g, "''");
        return `'${escaped}'`;
      } else if (value instanceof Date) {
        return `'${value.toISOString()}'`;
      } else {
        return `'${JSON.stringify(value)}'`;
      }
    });

    return result;
  }
}

export function createClickHouseAdapter(config: ClickHouseConfig): DatabaseAdapter {
  return new ClickHouseAdapter(config);
}
