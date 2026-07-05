import type { AnyInsertState, SchemaDefinition } from '../types/builder-state.js';
import type { InsertResultSummary } from '../adapters/database-adapter.js';
import { InsertBuilder } from '../insert-builder.js';
import { logger } from '../utils/logger.js';

interface InsertExecutorRunOptions {
  queryId?: string;
}

function normalizeInsertValue(value: unknown): unknown {
  if (value instanceof Date) {
    return value.toISOString();
  }
  if (typeof value === 'bigint') {
    return String(value);
  }
  if (Array.isArray(value)) {
    return value.map(normalizeInsertValue);
  }
  if (value !== null && typeof value === 'object') {
    const proto = Object.getPrototypeOf(value);
    if (proto === Object.prototype || proto === null) {
      const normalized: Record<string, unknown> = {};
      for (const [key, entry] of Object.entries(value)) {
        normalized[key] = normalizeInsertValue(entry);
      }
      return normalized;
    }
  }
  return value;
}

/**
 * Prepares rows for JSONEachRow serialization: `Date` values become ISO-8601
 * strings and `bigint` values become decimal strings (JSON.stringify throws on
 * bigint). Recurses through arrays and plain objects (Map columns).
 */
export function normalizeInsertRows<T extends Record<string, unknown>>(
  rows: T[]
): Record<string, unknown>[] {
  return rows.map(row => normalizeInsertValue(row) as Record<string, unknown>);
}

export class InsertExecutorFeature<
  Schema extends SchemaDefinition<Schema>,
  State extends AnyInsertState
> {
  constructor(private builder: InsertBuilder<Schema, State>) { }

  async execute(options?: InsertExecutorRunOptions): Promise<InsertResultSummary> {
    const queryNode = this.builder.getQueryNode();
    if (queryNode.rows.length === 0) {
      throw new Error('No values provided. Call .values() before .execute().');
    }

    const adapter = this.builder.getAdapter();
    if (!adapter.insert) {
      throw new Error(
        `Inserts are not supported by adapter "${adapter.name}". Implement DatabaseAdapter.insert to enable them.`
      );
    }

    // Synthetic statement for logs only — row data is never serialized into logs.
    const tableName = this.builder.getTableName();
    const columnsSql = queryNode.columns?.length ? ` (${queryNode.columns.join(', ')})` : '';
    const renderSql = `INSERT INTO ${tableName}${columnsSql} FORMAT JSONEachRow /* ${queryNode.rows.length} rows */`;

    const startTime = Date.now();
    logger.logQuery({
      query: renderSql,
      startTime,
      status: 'started',
      queryId: options?.queryId,
    });

    try {
      const rows = normalizeInsertRows(queryNode.rows);
      const result = await adapter.insert(tableName, rows, {
        clickhouseSettings: queryNode.settings,
        queryId: options?.queryId,
        columns: queryNode.columns,
      });
      const endTime = Date.now();

      logger.logQuery({
        query: renderSql,
        startTime,
        endTime,
        duration: endTime - startTime,
        status: 'completed',
        rowCount: queryNode.rows.length,
        queryId: result.queryId || options?.queryId,
      });

      return result;
    } catch (error) {
      const endTime = Date.now();
      logger.logQuery({
        query: renderSql,
        startTime,
        endTime,
        duration: endTime - startTime,
        status: 'error',
        error: error as Error,
        queryId: options?.queryId,
      });
      throw error;
    }
  }
}
