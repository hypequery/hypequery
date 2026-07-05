import type { ClickHouseSettings } from '@clickhouse/client-common';
import type {
  DatabaseAdapter,
  InsertResultSummary,
} from './adapters/database-adapter.js';
import type { SchemaDefinition } from './types/builder-state.js';
import type { InsertRow, InsertRowForColumns } from '../types/insert.js';
import { logger } from './utils/logger.js';

export interface InsertExecuteOptions {
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

/**
 * A type-safe insert builder for ClickHouse tables.
 *
 * Row shapes are derived from the schema: `Nullable(...)` columns are optional,
 * every other column is required. Use {@link columns} to insert a subset of
 * columns and let ClickHouse fill table DEFAULTs for the rest.
 *
 * Instances are immutable — every method returns a new builder.
 *
 * @example
 * ```ts
 * await db.insertInto('events')
 *   .values([{ id: 1, name: 'signup', created_at: new Date() }])
 *   .execute();
 * ```
 */
export class InsertBuilder<
  Schema extends SchemaDefinition<Schema>,
  Table extends Extract<keyof Schema, string>,
  Row extends Record<string, unknown> = InsertRow<Schema[Table]>
> {
  private rows: Row[] = [];
  private columnList?: string[];
  private clickhouseSettings?: ClickHouseSettings;

  constructor(
    private tableName: Table,
    private adapter: DatabaseAdapter
  ) { }

  private clone<NextRow extends Record<string, unknown>>(): InsertBuilder<Schema, Table, NextRow> {
    const next = new InsertBuilder<Schema, Table, NextRow>(this.tableName, this.adapter);
    next.rows = [...this.rows] as unknown as NextRow[];
    next.columnList = this.columnList ? [...this.columnList] : undefined;
    next.clickhouseSettings = this.clickhouseSettings ? { ...this.clickhouseSettings } : undefined;
    return next;
  }

  /**
   * Restricts the insert to a subset of columns. Omitted columns take their
   * table DEFAULT values. Must be called before {@link values}.
   *
   * @example
   * ```ts
   * await db.insertInto('events')
   *   .columns(['id', 'name'])
   *   .values([{ id: 1, name: 'a' }])
   *   .execute();
   * ```
   */
  columns<K extends Extract<keyof Schema[Table], string>>(
    columns: readonly K[]
  ): InsertBuilder<Schema, Table, InsertRowForColumns<Schema[Table], K>> {
    if (this.rows.length > 0) {
      throw new Error('Call .columns() before .values().');
    }
    const next = this.clone<InsertRowForColumns<Schema[Table], K>>();
    next.columnList = [...columns];
    return next;
  }

  /**
   * Adds one row or an array of rows to insert. Can be chained; rows accumulate.
   */
  values(rows: Row | Row[]): InsertBuilder<Schema, Table, Row> {
    const next = this.clone<Row>();
    const added = (Array.isArray(rows) ? rows : [rows]) as Row[];
    next.rows = [...this.rows, ...added];
    return next;
  }

  /**
   * Merges ClickHouse settings applied to this insert
   * (e.g. `{ async_insert: 1, wait_for_async_insert: 1 }`).
   */
  settings(settings: ClickHouseSettings): InsertBuilder<Schema, Table, Row> {
    const next = this.clone<Row>();
    next.clickhouseSettings = { ...next.clickhouseSettings, ...settings };
    return next;
  }

  /**
   * Executes the insert through the adapter's native insert path (JSONEachRow).
   */
  async execute(options?: InsertExecuteOptions): Promise<InsertResultSummary> {
    if (this.rows.length === 0) {
      throw new Error('No values provided. Call .values() before .execute().');
    }
    const adapter = this.adapter;
    if (!adapter.insert) {
      throw new Error(
        `Inserts are not supported by adapter "${adapter.name}". Implement DatabaseAdapter.insert to enable them.`
      );
    }

    // Synthetic statement for logs only — row data is never serialized into logs.
    const columnsSql = this.columnList?.length ? ` (${this.columnList.join(', ')})` : '';
    const logSql = `INSERT INTO ${this.tableName}${columnsSql} FORMAT JSONEachRow /* ${this.rows.length} rows */`;
    const startTime = Date.now();
    logger.logQuery({
      query: logSql,
      startTime,
      status: 'started',
      queryId: options?.queryId,
    });

    try {
      const normalized = normalizeInsertRows(this.rows);
      const result = await adapter.insert(this.tableName, normalized, {
        clickhouseSettings: this.clickhouseSettings,
        queryId: options?.queryId,
        columns: this.columnList,
      });
      const endTime = Date.now();
      logger.logQuery({
        query: logSql,
        startTime,
        endTime,
        duration: endTime - startTime,
        status: 'completed',
        rowCount: this.rows.length,
        queryId: result.queryId || options?.queryId,
      });
      return result;
    } catch (error) {
      const endTime = Date.now();
      logger.logQuery({
        query: logSql,
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
