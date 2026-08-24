import type { ClickHouseSettings } from '@clickhouse/client-common';
import type { AnyInsertState, SchemaDefinition } from '../types/builder-state.js';
import type { InsertResultSummary } from '../adapters/database-adapter.js';
import { InsertBuilder } from '../insert-builder.js';
import { logger } from '../utils/logger.js';
import {
  assertSafeIdentifier,
  assertSafeInsertIdentifiers,
} from '../utils/insert-identifiers.js';

interface InsertExecutorRunOptions {
  queryId?: string;
  abortSignal?: AbortSignal;
}

function normalizeInsertValue(value: unknown): unknown {
  if (value instanceof Date) {
    return value.toISOString();
  }
  if (typeof value === 'bigint') {
    return String(value);
  }
  if (typeof value === 'number' && !Number.isFinite(value)) {
    // JSON.stringify would silently coerce NaN/Infinity to null.
    throw new Error(
      `Cannot insert non-finite number ${value}: JSON serialization would coerce it to null.`
    );
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

export interface JsonEachRowInsertOptions {
  /** Explicit column subset; omitted columns take table DEFAULTs. */
  columns?: string[];
  /** Merged over the default `date_time_input_format: 'best_effort'`. */
  clickhouseSettings?: ClickHouseSettings;
}

function renderSettingValue(value: unknown): string {
  if (typeof value === 'number') {
    return String(value);
  }
  if (typeof value === 'boolean') {
    return value ? '1' : '0';
  }
  const escaped = String(value).replace(/\\/g, '\\\\').replace(/'/g, "''");
  return `'${escaped}'`;
}

/**
 * Renders a complete `INSERT INTO ... FORMAT JSONEachRow` statement with the
 * row payload inlined as newline-delimited JSON.
 *
 * Exported for `DatabaseAdapter` authors (e.g. embedded engines like chDB) so
 * a custom `insert` implementation stays byte-identical with the built-in
 * adapter: rows are normalized the same way (see {@link normalizeInsertRows})
 * and `date_time_input_format='best_effort'` is inlined in the SETTINGS clause
 * by default so DateTime columns accept the normalized ISO timestamps.
 *
 * @example
 * ```ts
 * async insert(table, rows, options) {
 *   await runSql(buildJsonEachRowInsert(table, rows, options));
 *   return { queryId: '', executed: true };
 * }
 * ```
 */
export function buildJsonEachRowInsert(
  table: string,
  rows: ReadonlyArray<Record<string, unknown>>,
  options?: JsonEachRowInsertOptions
): string {
  assertSafeInsertIdentifiers(table, options?.columns);
  Object.keys(options?.clickhouseSettings ?? {})
    .forEach(key => assertSafeIdentifier(key, 'setting'));
  const normalized = normalizeInsertRows([...rows]);
  const columnsSql = options?.columns?.length ? ` (${options.columns.join(', ')})` : '';
  const settings: Record<string, unknown> = {
    date_time_input_format: 'best_effort',
    ...options?.clickhouseSettings,
  };
  const settingsSql = Object.entries(settings)
    .map(([key, value]) => `${key}=${renderSettingValue(value)}`)
    .join(', ');
  const payload = normalized.map(row => JSON.stringify(row)).join('\n');
  return `INSERT INTO ${table}${columnsSql} SETTINGS ${settingsSql} FORMAT JSONEachRow\n${payload}`;
}

export class InsertExecutorFeature<
  Schema extends SchemaDefinition<Schema>,
  State extends AnyInsertState
> {
  constructor(private builder: InsertBuilder<Schema, State>) { }

  async execute(options?: InsertExecutorRunOptions): Promise<InsertResultSummary> {
    const queryNode = this.builder.getQueryNode();
    if (!this.builder.hasValues()) {
      throw new Error('No values provided. Call .values() before .execute().');
    }

    const adapter = this.builder.getAdapter();
    if (!adapter.insert) {
      throw new Error(
        `Inserts are not supported by adapter "${adapter.name}". Implement DatabaseAdapter.insert to enable them.`
      );
    }

    if (queryNode.rows.length === 0) {
      // An explicit empty batch sends no request, mirroring the native client.
      return { queryId: '', executed: false };
    }

    // Synthetic statement for logs only — row data is never serialized into logs.
    const tableName = this.builder.getTableName();
    assertSafeInsertIdentifiers(tableName, queryNode.columns);
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
        abortSignal: options?.abortSignal,
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
