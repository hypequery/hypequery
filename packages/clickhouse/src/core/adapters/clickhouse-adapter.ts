import type {
  DatabaseAdapter,
  QueryExecutionOptions,
  InsertExecutionOptions,
  InsertResultSummary,
} from './database-adapter.js';
import type { ClickHouseClient as NodeClickHouseClient } from '@clickhouse/client';
import type { ClickHouseClient as WebClickHouseClient } from '@clickhouse/client-web';
import type {
  ClickHouseAdapterConfig,
  IntegerJsonEncoding,
} from '../query-builder.js';
import { substituteParameters } from '../utils.js';
import { createJsonEachRowStream } from '../utils/streaming-helpers.js';
import { createByteStream } from '../utils/byte-stream.js';
import { EXCEPTION_TAG_HEADER } from '../utils/stream-exception.js';
import { withFormatClause } from '../utils/format-clause.js';
import { assertSafeInsertIdentifiers } from '../utils/insert-identifiers.js';
import { consumeResultWithAbort } from '../utils/abortable-result.js';
import { throwIfAborted } from '../utils/abort.js';
import {
  createClickHouseClient,
  deriveClickHouseNamespace,
  type ClickHouseClient,
} from '../utils/clickhouse-adapter-config.js';
import {
  buildIntegerJsonSettings,
  createReadonlyIntegerJsonError,
} from '../utils/integer-json-encoding.js';
import type { ClickHouseSettings } from '../../types/clickhouse-settings.js';
import { toClientSettings } from '../utils/clickhouse-client-compat.js';

/**
 * The node and web clients return structurally different `ResultSet`s (the web
 * one lacks `log_error` and `Symbol.dispose`). Naming the union keeps it intact
 * through the readonly-guidance wrapper, which would otherwise infer only the
 * first member and reject the other.
 */
type QueryResultSet =
  | Awaited<ReturnType<NodeClickHouseClient['query']>>
  | Awaited<ReturnType<WebClickHouseClient['query']>>;

export class ClickHouseAdapter implements DatabaseAdapter {
  readonly name = 'clickhouse';
  readonly namespace?: string;
  private client: ClickHouseClient;
  /** Connection-level settings, so they can outrank the adapter's own defaults. */
  private readonly configSettings?: ClickHouseSettings;
  private readonly integerJsonEncoding: IntegerJsonEncoding;

  constructor(config: ClickHouseAdapterConfig) {
    this.namespace = deriveClickHouseNamespace(config);
    this.client = createClickHouseClient(config);
    this.configSettings = config.clickhouse_settings;
    this.integerJsonEncoding = config.integerJsonEncoding ?? 'quoted';
  }

  /**
   * Converts only rejections of the adapter-owned precision setting into an
   * actionable configuration error. Caller-owned settings and unrelated
   * readonly failures retain their original error identity.
   */
  private async withReadonlyGuidance<T>(
    optionSettings: ClickHouseSettings | undefined,
    send: (settings: ClickHouseSettings) => Promise<T>,
  ): Promise<T> {
    const attempt = buildIntegerJsonSettings(
      this.integerJsonEncoding,
      this.configSettings,
      optionSettings,
    );

    try {
      return await send(attempt.settings);
    } catch (error) {
      const guidanceError = createReadonlyIntegerJsonError(
        error,
        attempt.adapterDefaultApplied,
      );
      throw guidanceError ?? error;
    }
  }

  async query<T>(sql: string, params: unknown[] = [], options?: QueryExecutionOptions): Promise<T[]> {
    // The ClickHouse clients never check an already-aborted signal, so fail before sending anything.
    throwIfAborted(options?.abortSignal);
    const finalSQL = substituteParameters(sql, params);
    const result = await this.withReadonlyGuidance<QueryResultSet>(
      options?.clickhouseSettings,
      clickhouseSettings =>
        this.client.query({
          query: finalSQL,
          format: 'JSONEachRow',
          clickhouse_settings: toClientSettings(clickhouseSettings),
          query_id: options?.queryId,
          abort_signal: options?.abortSignal,
        }),
    );
    // The web client types `json()` as the union of every format's shape; with
    // `format: 'JSONEachRow'` it is always a row array.
    return consumeResultWithAbort(
      options?.abortSignal,
      result,
      () => result.json<T>() as Promise<T[]>,
    );
  }

  async stream<T>(sql: string, params: unknown[] = [], options?: QueryExecutionOptions): Promise<ReadableStream<T[]>> {
    throwIfAborted(options?.abortSignal);
    const finalSQL = substituteParameters(sql, params);
    const result = await this.withReadonlyGuidance<QueryResultSet>(
      options?.clickhouseSettings,
      clickhouseSettings =>
        this.client.query({
          query: finalSQL,
          format: 'JSONEachRow',
          clickhouse_settings: toClientSettings(clickhouseSettings),
          query_id: options?.queryId,
          abort_signal: options?.abortSignal,
        }),
    );
    const stream = result.stream();
    return createJsonEachRowStream<T>(stream as NodeJS.ReadableStream, options?.abortSignal);
  }

  /**
   * Streams the result as uncompressed Arrow IPC stream bytes. Batches are
   * uncompressed by default because JavaScript Arrow readers ship without the
   * LZ4 codec ClickHouse would otherwise use; a connection-level
   * `output_format_arrow_compression_method` outranks that default, and a
   * per-call one outranks both. Use HTTP response compression to shrink the
   * transfer instead.
   */
  async streamArrow(sql: string, params: unknown[] = [], options?: QueryExecutionOptions): Promise<ReadableStream<Uint8Array>> {
    throwIfAborted(options?.abortSignal);
    const finalSQL = withFormatClause(substituteParameters(sql, params), 'ArrowStream');
    const configSettings = this.configSettings as Record<string, unknown> | undefined;
    const defaults = configSettings?.output_format_arrow_compression_method === undefined
      ? { output_format_arrow_compression_method: 'none' }
      : {};
    const result = await this.client.exec({
      query: finalSQL,
      clickhouse_settings: toClientSettings({ ...defaults, ...options?.clickhouseSettings } as ClickHouseSettings),
      query_id: options?.queryId,
      abort_signal: options?.abortSignal,
    });
    const tag = result.response_headers[EXCEPTION_TAG_HEADER];
    return createByteStream(result.stream as NodeJS.ReadableStream | ReadableStream<Uint8Array>, {
      exceptionTag: typeof tag === 'string' ? tag : undefined,
      abortSignal: options?.abortSignal,
    });
  }

  async insert<T extends Record<string, unknown>>(
    table: string,
    rows: T[],
    options?: InsertExecutionOptions
  ): Promise<InsertResultSummary> {
    throwIfAborted(options?.abortSignal);
    assertSafeInsertIdentifiers(table, options?.columns);
    const result = await this.client.insert({
      table,
      values: rows,
      format: 'JSONEachRow',
      ...(options?.columns && options.columns.length > 0
        ? { columns: options.columns as [string, ...string[]] }
        : {}),
      clickhouse_settings: toClientSettings({
        // Lets ISO-8601 timestamps (JSON.stringify'd Date values) parse into DateTime columns.
        date_time_input_format: 'best_effort',
        ...options?.clickhouseSettings,
      }),
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

export function createClickHouseAdapter(config: ClickHouseAdapterConfig): DatabaseAdapter {
  return new ClickHouseAdapter(config);
}
