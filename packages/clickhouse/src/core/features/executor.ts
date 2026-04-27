import type { BuilderState, SchemaDefinition } from '../types/builder-state.js';
import { QueryBuilder } from '../query-builder.js';
import { logger, type QueryLog } from '../utils/logger.js';
import { substituteParameters } from '../utils.js';

interface ExecutorRunOptions {
  queryId?: string;
  logContext?: Partial<QueryLog>;
}

export class ExecutorFeature<
  Schema extends SchemaDefinition<Schema>,
  State extends BuilderState<Schema, string, any, keyof Schema, Partial<Record<string, keyof Schema>>>
> {
  constructor(private builder: QueryBuilder<Schema, State>) { }

  toSQLWithParams(): { sql: string, parameters: any[] } {
    const compiled = this.compileQuery();
    return { sql: compiled.query, parameters: [...compiled.parameters] };
  }

  toSQL(): string {
    const { sql, parameters } = this.toSQLWithParams();
    const adapter = this.builder.getAdapter();
    return adapter.render ? adapter.render(sql, parameters) : substituteParameters(sql, parameters);
  }

  async execute(options?: ExecutorRunOptions): Promise<State['output'][]> {
    const adapter = this.builder.getAdapter();
    const { sql, parameters } = this.toSQLWithParams();
    const config = this.builder.getConfig();
    const renderSql = adapter.render ? adapter.render(sql, parameters) : substituteParameters(sql, parameters);

    const startTime = Date.now();
    logger.logQuery({
      query: renderSql,
      parameters,
      startTime,
      status: 'started',
      queryId: options?.queryId,
      ...options?.logContext
    });

    try {
      const rows = await adapter.query<State['output']>(sql, parameters, {
        clickhouseSettings: config.settings,
        queryId: options?.queryId,
      });
      const endTime = Date.now();

      logger.logQuery({
        query: renderSql,
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
        query: renderSql,
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

  async stream(): Promise<ReadableStream<State['output'][]>> {
    const adapter = this.builder.getAdapter();
    const { sql, parameters } = this.toSQLWithParams();
    const config = this.builder.getConfig();
    const renderSql = adapter.render ? adapter.render(sql, parameters) : substituteParameters(sql, parameters);

    const startTime = Date.now();
    logger.logQuery({
      query: renderSql,
      parameters,
      startTime,
      status: 'started'
    });

    try {
      if (!adapter.stream) {
        throw new Error(`Streaming is not supported by adapter "${adapter.name}".`);
      }
      const webStream = await adapter.stream<State['output']>(sql, parameters, {
        clickhouseSettings: config.settings,
      });

      const endTime = Date.now();
      logger.logQuery({
        query: renderSql,
        parameters,
        startTime,
        endTime,
        duration: endTime - startTime,
        status: 'completed'
      });

      return webStream;
    } catch (error) {
      const endTime = Date.now();
      logger.logQuery({
        query: renderSql,
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
