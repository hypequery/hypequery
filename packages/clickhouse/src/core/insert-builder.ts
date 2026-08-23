import type { ClickHouseSettings } from '@clickhouse/client-common';
import type { DatabaseAdapter, InsertResultSummary } from './adapters/database-adapter.js';
import type { InsertQueryNode } from '../types/index.js';
import type {
  SchemaDefinition,
  InsertState,
  InitialInsertState,
  UpdateInsertRow,
} from './types/builder-state.js';
import type { InsertRowForColumns } from '../types/insert.js';
import { cloneInsertQueryNode, createInsertQueryNode } from './query-node.js';
import { InsertExecutorFeature } from './features/insert-executor.js';

export interface InsertExecuteOptions {
  queryId?: string;
  abortSignal?: AbortSignal;
}

/**
 * A type-safe insert builder for ClickHouse tables.
 * The builder carries a single state object that encodes the schema, target
 * table, and accepted row shape.
 *
 * Row shapes are derived from the schema: `Nullable(...)` columns are optional,
 * every other column is required. Use {@link columns} to insert a subset of
 * columns and let ClickHouse fill table DEFAULTs for the rest.
 *
 * Instances are immutable — every method returns a new builder.
 *
 * @example
 * ```ts
 * await db.insert('events')
 *   .values([{ id: 1, name: 'signup', created_at: new Date() }])
 *   .execute();
 * ```
 */
export class InsertBuilder<
  Schema extends SchemaDefinition<Schema>,
  State extends InsertState<Schema, keyof Schema, any>
> {
  private query: InsertQueryNode;
  private tableName: string;
  private state: State;
  private executor: InsertExecutorFeature<Schema, State>;
  private adapter: DatabaseAdapter;
  private valuesProvided = false;

  constructor(
    tableName: string,
    state: State,
    adapter: DatabaseAdapter,
    query?: InsertQueryNode
  ) {
    this.tableName = tableName;
    this.query = query ? cloneInsertQueryNode(query) : createInsertQueryNode();
    this.state = state;
    this.adapter = adapter;
    this.executor = new InsertExecutorFeature(this);
  }

  private fork<NextState extends InsertState<Schema, State['table'], any>>(
    state: NextState,
    query: InsertQueryNode
  ): InsertBuilder<Schema, NextState> {
    const builder = new InsertBuilder<Schema, NextState>(
      this.tableName,
      state,
      this.adapter,
      query
    );
    builder.valuesProvided = this.valuesProvided;
    return builder;
  }

  private updateQuery(updater: (query: InsertQueryNode) => InsertQueryNode): this {
    return this.fork(this.state, updater(this.query)) as this;
  }

  /**
   * Restricts the insert to a subset of columns. Omitted columns take their
   * table DEFAULT values. Must be called before {@link values}.
   *
   * @example
   * ```ts
   * await db.insert('events')
   *   .columns(['id', 'name'])
   *   .values([{ id: 1, name: 'a' }])
   *   .execute();
   * ```
   */
  columns<K extends Extract<keyof Schema[State['table']], string>>(
    columns: readonly K[]
  ): InsertBuilder<Schema, UpdateInsertRow<State, InsertRowForColumns<Schema[State['table']], K>>> {
    if (this.query.rows.length > 0) {
      throw new Error('Call .columns() before .values().');
    }

    type NextState = UpdateInsertRow<State, InsertRowForColumns<Schema[State['table']], K>>;
    const nextState = {
      ...this.state,
      row: {} as NextState['row'],
    } as NextState;

    return this.fork<NextState>(nextState, { ...this.query, columns: [...columns] });
  }

  /**
   * Adds one row or an array of rows to insert. Can be chained; rows accumulate.
   *
   * An explicit empty array is a valid no-op batch: `execute()` sends no
   * request and resolves `{ executed: false }`, mirroring the native client.
   */
  values(rows: State['row'] | ReadonlyArray<State['row']>): this {
    const added = (Array.isArray(rows) ? rows : [rows]) as Record<string, unknown>[];
    const next = this.updateQuery(query => ({
      ...query,
      rows: [...query.rows, ...added],
    }));
    next.valuesProvided = true;
    return next;
  }

  /**
   * Merges ClickHouse settings applied to this insert
   * (e.g. `{ async_insert: 1, wait_for_async_insert: 1 }`).
   */
  settings(opts: ClickHouseSettings): this {
    return this.updateQuery(query => ({
      ...query,
      settings: { ...query.settings, ...opts },
    }));
  }

  // Make needed properties accessible to features
  getTableName() {
    return this.tableName;
  }

  getAdapter(): DatabaseAdapter {
    return this.adapter;
  }

  getQueryNode(): InsertQueryNode {
    return cloneInsertQueryNode(this.query);
  }

  hasValues(): boolean {
    return this.valuesProvided;
  }

  /**
   * Executes the insert through the adapter's native insert path (JSONEachRow).
   */
  execute(options?: InsertExecuteOptions): Promise<InsertResultSummary> {
    return this.executor.execute(options);
  }
}

export type InsertQB<
  Schema extends SchemaDefinition<Schema>,
  Table extends keyof Schema
> = InsertBuilder<Schema, InitialInsertState<Schema, Table>>;
