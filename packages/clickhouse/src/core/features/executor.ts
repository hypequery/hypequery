import { Readable } from 'node:stream';
import type { BuilderState, SchemaDefinition } from '../types/builder-state.js';
import { QueryBuilder } from '../query-builder.js';
import { ClickHouseConnection } from '../connection.js';
import { substituteParameters } from '../utils.js';
import { logger } from '../utils/logger.js';

export class ExecutorFeature<
  Schema extends SchemaDefinition<Schema>,
  State extends BuilderState<Schema, string, any, keyof Schema, Partial<Record<string, keyof Schema>>>
> {
  constructor(private builder: QueryBuilder<Schema, State>) { }

  toSQLWithParams(): { sql: string, parameters: any[] } {
    const sql = this.toSQLWithoutParameters();
    const config = this.builder.getConfig();
    const parameters = config.parameters || [];
    return { sql, parameters };
  }

  toSQL(): string {
    const { sql, parameters } = this.toSQLWithParams();
    return substituteParameters(sql, parameters);
  }

  async execute(): Promise<State['output'][]> {
    const client = ClickHouseConnection.getClient();
    const { sql, parameters } = this.toSQLWithParams();
    const finalSQL = substituteParameters(sql, parameters);

    const startTime = Date.now();
    logger.logQuery({
      query: finalSQL,
      parameters,
      startTime,
      status: 'started'
    });

    try {
      const result = await client.query({
        query: finalSQL,
        format: 'JSONEachRow'
      });

      const rows = await result.json<State['output']>();
      const endTime = Date.now();

      logger.logQuery({
        query: finalSQL,
        parameters,
        startTime,
        endTime,
        duration: endTime - startTime,
        status: 'completed',
        rowCount: rows.length
      });

      return rows;
    } catch (error) {
      const endTime = Date.now();
      logger.logQuery({
        query: finalSQL,
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

  async stream(): Promise<ReadableStream<State['output'][]>> {
    const client = ClickHouseConnection.getClient();
    const { sql, parameters } = this.toSQLWithParams();
    const finalSQL = substituteParameters(sql, parameters);

    const startTime = Date.now();
    logger.logQuery({
      query: finalSQL,
      parameters,
      startTime,
      status: 'started'
    });

    try {
      const result = await client.query({
        query: finalSQL,
        format: 'JSONEachRow'
      });

      const nodeStream = result.stream();
      let buffer = '';

      const flushBuffer = (): State['output'][] => {
        if (!buffer.length) {
          return [];
        }
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';
        const rows: State['output'][] = [];
        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed.length) {
            continue;
          }
          rows.push(JSON.parse(trimmed) as State['output']);
        }
        return rows;
      };

      const normalizeChunk = async (chunk: any): Promise<State['output'][]> => {
        if (chunk == null) {
          return [];
        }

        if (Array.isArray(chunk)) {
          const rows: State['output'][] = [];
          for (const item of chunk) {
            rows.push(...await normalizeChunk(item));
          }
          return rows;
        }

        if (typeof chunk.json === 'function') {
          return [await chunk.json() as State['output']];
        }

        if (typeof chunk.text === 'function') {
          const text = await chunk.text();
          return [JSON.parse(text) as State['output']];
        }

        if (typeof chunk.text === 'string') {
          return [JSON.parse(chunk.text) as State['output']];
        }

        if (Buffer.isBuffer(chunk)) {
          buffer += chunk.toString('utf8');
          return flushBuffer();
        }

        if (typeof chunk === 'string') {
          buffer += chunk;
          return flushBuffer();
        }

        if (typeof chunk === 'object') {
          return [chunk as State['output']];
        }

        return [];
      };

      const iterator = nodeStream[Symbol.asyncIterator]?.();
      let webReader: ReadableStreamDefaultReader<Uint8Array> | undefined;

      const getNextChunk = async (): Promise<{ done: boolean, value?: any }> => {
        if (iterator) {
          return iterator.next();
        }

        if (!webReader) {
          const web = Readable.toWeb(nodeStream as NodeJS.ReadableStream);
          webReader = web.getReader();
        }
        return webReader.read();
      };

      const webStream = new ReadableStream<State['output'][]>({
        async pull(controller) {
          const { done, value } = await getNextChunk();
          if (done) {
            const remaining = flushBuffer();
            if (remaining.length) {
              controller.enqueue(remaining);
            }
            controller.close();
            return;
          }

          const rows = await normalizeChunk(value);
          if (rows.length) {
            controller.enqueue(rows);
          }
        },
        async cancel() {
          if (iterator && typeof iterator.return === 'function') {
            try {
              await iterator.return();
            } catch {}
          }
          nodeStream.destroy();
        }
      });

      const endTime = Date.now();
      logger.logQuery({
        query: finalSQL,
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
        query: finalSQL,
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

  private toSQLWithoutParameters(): string {
    const config = this.builder.getConfig();
    const formatter = this.builder.getFormatter();
    const parts: string[] = [];

    if (config.ctes?.length) {
      parts.push(`WITH ${config.ctes.join(', ')}`);
    }

    parts.push(`SELECT ${formatter.formatSelect(config)}`);
    parts.push(`FROM ${this.builder.getTableName()}`);

    if (config.joins?.length) {
      parts.push(formatter.formatJoins(config));
    }

    if (config.where?.length) {
      parts.push(`WHERE ${formatter.formatWhere(config)}`);
    }

    if (config.groupBy?.length) {
      parts.push(`GROUP BY ${formatter.formatGroupBy(config)}`);
    }

    if (config.having?.length) {
      parts.push(`HAVING ${config.having.join(' AND ')}`);
    }

    if (config.orderBy?.length) {
      const orderBy = config.orderBy
        .map(({ column, direction }) => `${String(column)} ${direction}`.trim())
        .join(', ');
      parts.push(`ORDER BY ${orderBy}`);
    }

    if (config.limit) {
      const offsetClause = config.offset ? `OFFSET ${config.offset}` : '';
      parts.push(`LIMIT ${config.limit} ${offsetClause}`);
    }

    return parts.join(' ').trim();
  }
}
