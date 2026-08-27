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
import { consumeResultWithAbort } from '../utils/abortable-result.js';
import { throwIfAborted } from '../utils/abort.js';
import { logger } from '../utils/logger.js';
import type { ClickHouseSettings } from '@clickhouse/client-common';

type ClickHouseClient = NodeClickHouseClient | WebClickHouseClient;

/**
 * The node and web clients return structurally different `ResultSet`s (the web
 * one lacks `log_error` and `Symbol.dispose`). Naming the union keeps it intact
 * through the readonly-retry wrapper, which would otherwise infer only the first
 * member and reject the other.
 */
type QueryResultSet =
  | Awaited<ReturnType<NodeClickHouseClient['query']>>
  | Awaited<ReturnType<WebClickHouseClient['query']>>;

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

const QUOTE_64BIT = 'output_format_json_quote_64bit_integers';

/**
 * Only attribute a readonly failure to the adapter default when ClickHouse
 * names that exact setting. Code 164 can also come from caller-owned settings
 * and forbidden operations, which must not disable precision-safe results.
 */
function isReadonlyQuote64BitError(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const { code, type } = error as { code?: unknown; type?: unknown };
  const message = (error as { message?: unknown }).message;
  if (typeof message !== 'string' || !message.includes(QUOTE_64BIT)) return false;

  return code === '164'
    || code === 164
    || type === 'READONLY'
    || /in readonly mode/i.test(message);
}

function hasQuote64BitSetting(settings?: ClickHouseSettings): boolean {
  return settings !== undefined && Object.prototype.hasOwnProperty.call(settings, QUOTE_64BIT);
}

interface QuerySettingsAttempt {
  settings: ClickHouseSettings;
  adapterDefaultApplied: boolean;
}

export class ClickHouseAdapter implements DatabaseAdapter {
  readonly name = 'clickhouse';
  readonly namespace?: string;
  private client: ClickHouseClient;
  /** Connection-level settings, so they can outrank the adapter's own defaults. */
  private readonly configSettings?: ClickHouseSettings;
  /** Cleared when the server rejects the adapter-owned default. */
  private quote64BitDefaultEnabled = true;

  constructor(private config: ClickHouseConfig) {
    this.namespace = deriveNamespace(config);
    this.client = createClickHouseClient(config);
    this.configSettings = config.clickhouse_settings;
  }

  /**
   * Precedence: adapter default < connection `clickhouse_settings` < per-query
   * settings. Previously the adapter's default was applied last for the
   * 64-bit-quoting flag, so a connection-level value could not override it.
   */
  private querySettings(optionSettings?: ClickHouseSettings): QuerySettingsAttempt {
    const adapterDefaultApplied = this.quote64BitDefaultEnabled
      && !hasQuote64BitSetting(this.configSettings)
      && !hasQuote64BitSetting(optionSettings);

    return {
      adapterDefaultApplied,
      settings: {
        // Matches generated Int64+ result types and prevents JSON.parse precision loss.
        ...(adapterDefaultApplied ? { [QUOTE_64BIT]: 1 } : {}),
        ...this.configSettings,
        ...optionSettings,
      },
    };
  }

  /**
   * Retries only when this request included the adapter-owned default and the
   * server specifically rejected it. Eligibility is captured before sending so
   * overlapping initial requests can each retry after the shared default is
   * disabled for future requests.
   */
  private async withReadonlyFallback<T>(
    optionSettings: ClickHouseSettings | undefined,
    abortSignal: AbortSignal | undefined,
    send: (settings: ClickHouseSettings) => Promise<T>,
  ): Promise<T> {
    const attempt = this.querySettings(optionSettings);

    try {
      return await send(attempt.settings);
    } catch (error) {
      if (!attempt.adapterDefaultApplied || !isReadonlyQuote64BitError(error)) throw error;

      // The ClickHouse clients do not check an already-aborted signal. The
      // caller may have cancelled while the first request was being rejected.
      throwIfAborted(abortSignal);

      const shouldWarn = this.quote64BitDefaultEnabled;
      this.quote64BitDefaultEnabled = false;
      if (shouldWarn) {
        logger.warn(
          `ClickHouse rejected '${QUOTE_64BIT}' under readonly mode; retrying without it. ` +
          `Int64 and larger values will be returned as JSON numbers, which loses precision ` +
          `beyond 2^53. Set '${QUOTE_64BIT}' explicitly in clickhouse_settings to silence this.`,
        );
      }

      const retrySettings = { ...attempt.settings };
      delete retrySettings[QUOTE_64BIT];
      return await send(retrySettings);
    }
  }

  async query<T>(sql: string, params: unknown[] = [], options?: QueryExecutionOptions): Promise<T[]> {
    // The ClickHouse clients never check an already-aborted signal, so fail before sending anything.
    throwIfAborted(options?.abortSignal);
    const finalSQL = substituteParameters(sql, params);
    const result = await this.withReadonlyFallback<QueryResultSet>(
      options?.clickhouseSettings,
      options?.abortSignal,
      clickhouseSettings =>
        this.client.query({
          query: finalSQL,
          format: 'JSONEachRow',
          clickhouse_settings: clickhouseSettings,
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
    // The settings error surfaces from client.query(), before any row is read,
    // so retrying here cannot replay a partially consumed stream.
    const result = await this.withReadonlyFallback<QueryResultSet>(
      options?.clickhouseSettings,
      options?.abortSignal,
      clickhouseSettings =>
        this.client.query({
          query: finalSQL,
          format: 'JSONEachRow',
          clickhouse_settings: clickhouseSettings,
          query_id: options?.queryId,
          abort_signal: options?.abortSignal,
        }),
    );
    const stream = result.stream();
    return createJsonEachRowStream<T>(stream as NodeJS.ReadableStream, options?.abortSignal);
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
