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
 * await db.insertInto('events')
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

  constructor(tableName: string, state: State, adapter: DatabaseAdapter) {
    this.tableName = tableName;
    this.query = createInsertQueryNode();
    this.state = state;
    this.adapter = adapter;
    this.executor = new InsertExecutorFeature(this);
  }

  private fork<NextState extends InsertState<Schema, State['table'], any>>(
    state: NextState,
    query: InsertQueryNode
  ): InsertBuilder<Schema, NextState> {
    const builder = new InsertBuilder<Schema, NextState>(this.tableName, state, this.adapter);
    builder.query = cloneInsertQueryNode(query);
    return builder;
  }

  private cloneMutable(): this {
    return this.fork(this.state, this.query) as this;
  }

  private assignQuery(builder: this, query: InsertQueryNode): this {
    builder.query = cloneInsertQueryNode(query);
    return builder;
  }

  private updateQuery(updater: (query: InsertQueryNode) => InsertQueryNode): this {
    return this.assignQuery(this.cloneMutable(), updater(this.query));
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
   */
  values(rows: State['row'] | ReadonlyArray<State['row']>): this {
    const added = (Array.isArray(rows) ? rows : [rows]) as Record<string, unknown>[];
    return this.updateQuery(query => ({
      ...query,
      rows: [...query.rows, ...added],
    }));
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
