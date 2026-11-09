import type { BuilderState, SchemaDefinition } from '../types/builder-state.js';
import { QueryBuilder } from '../query-builder.js';
import { logger, type QueryLog } from '../utils/logger.js';
import { substituteParameters } from '../utils.js';
import { splitSqlPlaceholders } from '../utils/sql-parens.js';
import type { DatabaseAdapter } from '../adapters/database-adapter.js';
import type { ClickHouseSettings } from '../../types/clickhouse-settings.js';

interface ExecutorRunOptions {
  queryId?: string;
  abortSignal?: AbortSignal;
  logContext?: Partial<QueryLog>;
}

interface ExecutorStreamOptions {
  abortSignal?: AbortSignal;
}

export class ExecutorFeature<
  Schema extends SchemaDefinition<Schema>,
  State extends BuilderState<Schema, string, any, keyof Schema, Partial<Record<string, keyof Schema>>, any, any>
> {
  constructor(private builder: QueryBuilder<Schema, State>) { }

  toSQLWithParams(): { sql: string, parameters: any[] } {
    const compiled = this.compileQuery();
    return { sql: compiled.query, parameters: [...compiled.parameters] };
  }

  toSQLWithPlaceholders(placeholder: (value: unknown) => string): string {
    const { sql, parameters } = this.toSQLWithParams();
    const parts = splitSqlPlaceholders(sql);
    if (parts.length - 1 !== parameters.length) {
      throw new Error(`Mismatch between placeholders and parameters. Found ${parts.length - 1} placeholders but ${parameters.length} parameters.`);
    }
    let rendered = parts[0]!;
    for (let i = 0; i < parameters.length; i++) {
      rendered += placeholder(parameters[i]) + parts[i + 1]!;
    }
    return rendered;
  }

  toSQL(): string {
    const { sql, parameters } = this.toSQLWithParams();
    const adapter = this.builder.getAdapter();
    return adapter.render ? adapter.render(sql, parameters) : substituteParameters(sql, parameters);
  }

  async execute(options?: ExecutorRunOptions): Promise<State['output'][]> {
    const adapter = this.builder.getAdapter();
    const queryNode = this.builder.toQueryNode();
    const { sql, parameters } = this.toSQLWithParams();

    const startTime = Date.now();
    logger.logQuery({
      query: sql,
      parameters,
      startTime,
      status: 'started',
      queryId: options?.queryId,
      ...options?.logContext
    });

    try {
      const rows = await adapter.query<State['output']>(sql, parameters, {
        clickhouseSettings: queryNode.settings,
        queryId: options?.queryId,
        abortSignal: options?.abortSignal,
      });
      const endTime = Date.now();

      logger.logQuery({
        query: sql,
        parameters,
        startTime,
        endTime,
        duration: endTime - startTime,
        status: 'completed',
        rowCount: rows.length,
        queryId: options?.queryId,
        cacheRowCount: rows.length,
        ...options?.logContext
      });

      return rows;
    } catch (error) {
      const endTime = Date.now();
      logger.logQuery({
        query: sql,
        parameters,
        startTime,
        endTime,
        duration: endTime - startTime,
        status: 'error',
        error: error as Error,
        queryId: options?.queryId,
        ...options?.logContext
      });
      throw error;
    }
  }

  async stream(options?: ExecutorStreamOptions): Promise<ReadableStream<State['output'][]>> {
    return this.openStream((adapter, sql, parameters, clickhouseSettings) => {
      if (!adapter.stream) {
        throw new Error(`Streaming is not supported by adapter "${adapter.name}".`);
      }
      return adapter.stream<State['output']>(sql, parameters, {
        clickhouseSettings,
        abortSignal: options?.abortSignal,
      });
    });
  }

  async streamArrow(options?: ExecutorStreamOptions): Promise<ReadableStream<Uint8Array>> {
    return this.openStream((adapter, sql, parameters, clickhouseSettings) => {
      if (!adapter.streamArrow) {
        throw new Error(`Arrow streaming is not supported by adapter "${adapter.name}".`);
      }
      return adapter.streamArrow(sql, parameters, {
        clickhouseSettings,
        abortSignal: options?.abortSignal,
      });
    });
  }

  /** Opens a result stream with the builder's settings, logging the request. */
  private async openStream<R>(
    open: (
      adapter: DatabaseAdapter,
      sql: string,
      parameters: unknown[],
      clickhouseSettings: ClickHouseSettings | undefined,
    ) => Promise<R>,
  ): Promise<R> {
    const adapter = this.builder.getAdapter();
    const queryNode = this.builder.toQueryNode();
    const { sql, parameters } = this.toSQLWithParams();

    const startTime = Date.now();
    logger.logQuery({
      query: sql,
      parameters,
      startTime,
      status: 'started'
    });

    try {
      const stream = await open(adapter, sql, parameters, queryNode.settings);

      const endTime = Date.now();
      logger.logQuery({
        query: sql,
        parameters,
        startTime,
        endTime,
        duration: endTime - startTime,
        status: 'completed'
      });

      return stream;
    } catch (error) {
      const endTime = Date.now();
      logger.logQuery({
        query: sql,
        parameters,
        startTime,
        endTime,
        duration: endTime - startTime,
        status: 'error',
        error: error as Error
      });
      throw error;
    }
  }

  private compileQuery() {
    const queryNode = this.builder.toQueryNode();
    return this.builder.getDialect().compileQuery(queryNode, {
      tableName: this.builder.getTableName(),
    });
  }
}
