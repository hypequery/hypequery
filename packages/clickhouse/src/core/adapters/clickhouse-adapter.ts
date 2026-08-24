import type {
  DatabaseAdapter,
  QueryExecutionOptions,
  InsertExecutionOptions,
  InsertResultSummary,
} from './database-adapter.js';
import type { ClickHouseClient as NodeClickHouseClient } from '@clickhouse/client';
import type { ClickHouseClient as WebClickHouseClient } from '@clickhouse/client-web';
import type { ClickHouseConfig } from '../query-builder.js';
import { isClientConfig } from '../query-builder.js';
import { substituteParameters } from '../utils.js';
import { getConnectionEndpoint } from '../utils/connection-endpoint.js';
import { createJsonEachRowStream } from '../utils/streaming-helpers.js';
import { getAutoClientModule } from '../env/auto-client.js';
import type { AutoClientModule } from '../env/auto-client.js';
import { assertSafeInsertIdentifiers } from '../utils/insert-identifiers.js';
import type { ClickHouseSettings } from '@clickhouse/client-common';

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

function abortError(signal: AbortSignal): unknown {
  return signal.reason ?? new Error('The query was aborted.');
}

interface CloseableResult {
  close(): void | Promise<void>;
}

function closeResult(result: CloseableResult): void {
  try {
    void Promise.resolve(result.close()).catch(() => undefined);
  } catch {
    // Destroying an already-consumed stream is fine to ignore.
  }
}

// The Node client detaches the caller's signal once response headers arrive, so
// keep our own bridge alive while the body is consumed.
function consumeWithAbort<T>(
  signal: AbortSignal | undefined,
  result: CloseableResult,
  consume: () => Promise<T>
): Promise<T> {
  if (!signal) {
    return consume();
  }
  if (signal.aborted) {
    closeResult(result);
    return Promise.reject(abortError(signal));
  }
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => {
      closeResult(result);
      reject(abortError(signal));
    };
    signal.addEventListener('abort', onAbort, { once: true });
    consume().then(
      value => {
        signal.removeEventListener('abort', onAbort);
        resolve(value);
      },
      error => {
        signal.removeEventListener('abort', onAbort);
        reject(error);
      }
    );
  });
}

function jsonOutputSettings(settings?: ClickHouseSettings): ClickHouseSettings {
  return {
    // Matches generated Int64+ result types and prevents JSON.parse precision loss.
    output_format_json_quote_64bit_integers: 1,
    ...settings,
  };
}

export class ClickHouseAdapter implements DatabaseAdapter {
  readonly name = 'clickhouse';
  readonly namespace?: string;
  private client: ClickHouseClient;

  constructor(private config: ClickHouseConfig) {
    this.namespace = deriveNamespace(config);
    this.client = createClickHouseClient(config);
  }

  async query<T>(sql: string, params: unknown[] = [], options?: QueryExecutionOptions): Promise<T[]> {
    // The ClickHouse clients never check an already-aborted signal, so fail before sending anything.
    options?.abortSignal?.throwIfAborted();
    const finalSQL = substituteParameters(sql, params);
    const result = await this.client.query({
      query: finalSQL,
      format: 'JSONEachRow',
      clickhouse_settings: jsonOutputSettings(options?.clickhouseSettings),
      query_id: options?.queryId,
      abort_signal: options?.abortSignal,
    });
    return consumeWithAbort(options?.abortSignal, result, () => result.json<T>());
  }

  async stream<T>(sql: string, params: unknown[] = [], options?: QueryExecutionOptions): Promise<ReadableStream<T[]>> {
    options?.abortSignal?.throwIfAborted();
    const finalSQL = substituteParameters(sql, params);
    const result = await this.client.query({
      query: finalSQL,
      format: 'JSONEachRow',
      clickhouse_settings: jsonOutputSettings(options?.clickhouseSettings),
      query_id: options?.queryId,
      abort_signal: options?.abortSignal,
    });
    const stream = result.stream();
    return createJsonEachRowStream<T>(stream as NodeJS.ReadableStream, options?.abortSignal);
  }

  async insert<T extends Record<string, unknown>>(
    table: string,
    rows: T[],
    options?: InsertExecutionOptions
  ): Promise<InsertResultSummary> {
    options?.abortSignal?.throwIfAborted();
    assertSafeInsertIdentifiers(table, options?.columns);
    const result = await this.client.insert({
      table,
      values: rows,
      format: 'JSONEachRow',
      ...(options?.columns && options.columns.length > 0
        ? { columns: options.columns as [string, ...string[]] }
        : {}),
      clickhouse_settings: {
        // Lets ISO-8601 timestamps (JSON.stringify'd Date values) parse into DateTime columns.
        date_time_input_format: 'best_effort',
        ...options?.clickhouseSettings,
      },
      query_id: options?.queryId,
      abort_signal: options?.abortSignal,
    });
    return {
      queryId: result.query_id,
      executed: result.executed,
      summary: result.summary,
    };
  }

  async close(): Promise<void> {
    await this.client.close();
  }

  render(sql: string, params: unknown[] = []): string {
    return substituteParameters(sql, params);
  }
}

export function createClickHouseAdapter(config: ClickHouseConfig): DatabaseAdapter {
  return new ClickHouseAdapter(config);
}
