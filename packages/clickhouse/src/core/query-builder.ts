import { ClickHouseConnection } from './connection.js';
import { CrossFilter } from './cross-filter.js';
import {
  FilterOperator,
  OperatorValueMap,
  OrderDirection,
  PaginatedResult,
  PaginationOptions,
  QueryConfig,
  JoinType
} from '../types/index.js';
import { AnySchema, ColumnType, InferColumnType } from '../types/schema.js';
import { SQLFormatter } from './formatters/sql-formatter.js';
import { AggregationFeature } from './features/aggregations.js';
import { JoinFeature } from './features/joins.js';
import { FilteringFeature } from './features/filtering.js';
import { AnalyticsFeature } from './features/analytics.js';
import { ExecutorFeature } from './features/executor.js';
import { QueryModifiersFeature } from './features/query-modifiers.js';
import { FilterValidator } from './validators/filter-validator.js';
import { PaginationFeature } from './features/pagination.js';
import { JoinRelationships, JoinPathOptions } from './join-relationships.js';
import { SqlExpression } from './utils/sql-expressions.js';
import {
  PredicateBuilder,
  PredicateExpression,
  createPredicateBuilder,
} from './utils/predicate-builder.js';
import { CrossFilteringFeature } from './features/cross-filtering.js';
import type { ClickHouseSettings, BaseClickHouseClientConfigOptions } from '@clickhouse/client-common';
import type { ClickHouseClient as NodeClickHouseClient } from '@clickhouse/client';
import type { ClickHouseClient as WebClickHouseClient } from '@clickhouse/client-web';
import type { CacheOptions, CacheConfig } from './cache/types.js';
import type { QueryRuntimeContext } from './cache/runtime-context.js';
import { buildRuntimeContext, resolveCacheConfig } from './cache/runtime-context.js';
import { CacheController } from './cache/controller.js';
import { executeWithCache } from './cache/cache-manager.js';
import { MemoryCacheProvider } from './cache/providers/memory-lru.js';
import type {
  BuilderState,
  AnyBuilderState,
  SchemaDefinition,
  InitialState,
  UpdateOutput,
  WidenTables,
  AppendToOutput,
  BaseRow,
  AddAlias
} from './types/builder-state.js';
import {
  SelectableItem,
  SelectableColumn,
  SelectionResult,
  ColumnSelectionValue
} from './types/select-types.js';

type WhereColumn<State extends AnyBuilderState> = SelectableColumn<State>;

type ColumnOperatorValue<
  Schema extends SchemaDefinition<Schema>,
  State extends BuilderState<Schema, string, any, keyof Schema, Partial<Record<string, keyof Schema>>>,
  Column extends WhereColumn<State>,
  Op extends keyof OperatorValueMap<any, Schema>
> = OperatorValueMap<ColumnSelectionValue<State, Column>, Schema>[Op];

// Union type that accepts either client type
type ClickHouseClient = NodeClickHouseClient | WebClickHouseClient;

export interface ExecuteOptions {
  queryId?: string;
  cache?: CacheOptions | false;
}

function mergeDefinedCacheOptions(target: CacheOptions | undefined, update?: CacheOptions): CacheOptions | undefined {
  if (!update) return target;
  const result: CacheOptions = { ...(target || {}) };
  for (const [key, value] of Object.entries(update) as [keyof CacheOptions, unknown][]) {
    if (key === 'tags') {
      const current = result.tags || [];
      const incoming = (value as string[]) || [];
      if (incoming.length) {
        result.tags = Array.from(new Set([...current, ...incoming]));
      }
      continue;
    }
    if (value !== undefined) {
      (result as Record<string, unknown>)[key as string] = value;
    }
  }
  return result;
}

/**
 * Configuration for client-based connections.
 */
export interface ClickHouseClientConfig extends BaseClickHouseClientConfigOptions {
  /** Pre-configured ClickHouse client instance. */
  client: ClickHouseClient;
}

/**
 * Configuration options for ClickHouse connections.
 * Either provide a client instance OR connection details, but not both.
 */
export type ClickHouseConfig = BaseClickHouseClientConfigOptions | ClickHouseClientConfig;

/**
 * Type guard to check if a config is a client-based configuration.
 */
export function isClientConfig(config: ClickHouseConfig): config is ClickHouseClientConfig {
  return 'client' in config && config.client !== undefined;
}

/**
 * A type-safe query builder for ClickHouse databases.
 * The builder carries a single state object that encodes scope, output, and schema metadata.
 */
export class QueryBuilder<
  Schema extends SchemaDefinition<Schema>,
  State extends BuilderState<Schema, string, any, keyof Schema, Partial<Record<string, keyof Schema>>>
> {
  private static relationships: JoinRelationships<any>;

  private config: QueryConfig<State['output'], Schema> = {};
  private tableName: string;
  private state: State;
  private formatter = new SQLFormatter();
  private aggregations: AggregationFeature<Schema, State>;
  private joins: JoinFeature<Schema, State>;
  private filtering: FilteringFeature<Schema, State>;
  private analytics: AnalyticsFeature<Schema, State>;
  private executor: ExecutorFeature<Schema, State>;
  private modifiers: QueryModifiersFeature<Schema, State>;
  private pagination: PaginationFeature<Schema, State>;
  private crossFiltering: CrossFilteringFeature<Schema, State>;
  private runtime: QueryRuntimeContext;
  private cacheOptions?: CacheOptions;

  constructor(
    tableName: string,
    state: State,
    runtime: QueryRuntimeContext
  ) {
    this.tableName = tableName;
    this.state = state;
    this.runtime = runtime;
    this.aggregations = new AggregationFeature(this);
    this.joins = new JoinFeature(this);
    this.filtering = new FilteringFeature(this);
    this.analytics = new AnalyticsFeature(this);
    this.executor = new ExecutorFeature(this);
    this.modifiers = new QueryModifiersFeature(this);
    this.pagination = new PaginationFeature(this);
    this.crossFiltering = new CrossFilteringFeature(this);
  }

  private fork<
    NextState extends BuilderState<
      Schema,
      string,
      any,
      State['baseTable'],
      Partial<Record<string, keyof Schema>>
    >
  >(
    state: NextState,
    config: QueryConfig<NextState['output'], Schema>
  ): QueryBuilder<Schema, NextState> {
    const builder = new QueryBuilder<Schema, NextState>(this.tableName, state, this.runtime);
    builder.config = { ...config };
    builder.cacheOptions = this.cacheOptions;
    return builder;
  }

  debug() {
    console.log('Current Type:', {
      state: this.state,
      config: this.config
    });
    return this;
  }

  cache(options: CacheOptions | false): this {
    if (options === false) {
      this.cacheOptions = { mode: 'no-store', ttlMs: 0, staleTtlMs: 0, cacheTimeMs: 0 };
      return this;
    }
    this.cacheOptions = mergeDefinedCacheOptions(this.cacheOptions, options) || options;
    return this;
  }

  // --- Analytics Helper: Add a CTE.
  withCTE(
    alias: string,
    subquery: QueryBuilder<any, AnyBuilderState> | string
  ): this {
    this.config = this.analytics.addCTE(alias, subquery);
    return this;
  }

  /**
 * Groups results by a time interval using a specified ClickHouse function.
 * 
 * @param column - The column containing the date or timestamp.
 * @param interval - The interval value. For example, "1 day" or "15 minute".
 *                   This is only used when the method is 'toStartOfInterval'.
 * @param method - The time bucketing function to use.
 *                 Defaults to 'toStartOfInterval'.
 *                 Other valid values include 'toStartOfMinute', 'toStartOfHour',
 *                 'toStartOfDay', 'toStartOfWeek', 'toStartOfMonth', 'toStartOfQuarter', and 'toStartOfYear'.
 * @returns The current QueryBuilder instance.
 */
  groupByTimeInterval(
    column: SelectableColumn<State>,
    interval: string,
    method: 'toStartOfInterval' | 'toStartOfMinute' | 'toStartOfHour' | 'toStartOfDay' | 'toStartOfWeek' | 'toStartOfMonth' | 'toStartOfQuarter' | 'toStartOfYear' = 'toStartOfInterval'
  ): this {
    this.config = this.analytics.addTimeInterval(String(column), interval, method);
    return this;
  }

  // --- Analytics Helper: Add a raw SQL fragment.
  raw(sql: string): this {
    // Use raw() to inject SQL that isn't supported by the builder.
    // Use with caution.
    this.config.having = this.config.having || [];
    this.config.having.push(sql);
    return this;
  }

  // --- Analytics Helper: Add query settings.
  settings(opts: ClickHouseSettings): this {
    this.config = this.analytics.addSettings(opts);
    return this;
  }

  /**
   * Applies a set of cross filters to the current query.
   * All filter conditions from the provided CrossFilter are added to the query.
   * @param crossFilter - An instance of CrossFilter containing shared filter conditions.
   * @returns The current QueryBuilder instance.
   */
  applyCrossFilters<TableName extends Extract<keyof Schema, string>>(crossFilter: CrossFilter<Schema, TableName>): this;
  applyCrossFilters(crossFilter: CrossFilter<AnySchema, string>): this;
  applyCrossFilters(
    crossFilter: CrossFilter<Schema, Extract<keyof Schema, string>> | CrossFilter<AnySchema, string>
  ): this {
    const normalized = crossFilter as unknown as CrossFilter<Schema, Extract<keyof Schema, string>>;
    this.config = this.crossFiltering.applyCrossFilters(normalized);
    return this;
  }


  /**
   * Selects specific columns from the table.
   * @template K - The keys/columns to select
   * @param {K[] | '*'} columnsOrAsterisk - Array of column names to select or '*' for all columns
   * @returns {QueryBuilder} A new QueryBuilder instance with updated types
   * @example
   * ```ts
   * builder.select(['id', 'name'])
   * builder.select('*')
   * ```
   */
  select(columnsOrAsterisk: '*'): QueryBuilder<Schema, UpdateOutput<State, BaseRow<State>>>;
  select<Selections extends ReadonlyArray<SelectableItem<State>>>(
    columnsOrAsterisk: Selections
  ): QueryBuilder<Schema, UpdateOutput<State, SelectionResult<State, Selections[number]>>>;
  select<Selections extends ReadonlyArray<SelectableItem<State>>>(columnsOrAsterisk: '*' | Selections) {
    if (columnsOrAsterisk === '*') {
      type NextState = UpdateOutput<State, BaseRow<State>>;
      const nextState = {
        ...this.state,
        output: {}
      } as NextState;

      const nextConfig = {
        ...this.config,
        select: ['*'],
        orderBy: this.config.orderBy?.map(({ column, direction }) => ({
          column: String(column),
          direction
        }))
      } as QueryConfig<NextState['output'], Schema>;

      return this.fork(nextState, nextConfig);
    }

    const columns = columnsOrAsterisk as Selections;

    const processedColumns = columns.map(col => {
      if (typeof col === 'object' && col !== null && '__type' in col) {
        return (col as SqlExpression).toSql();
      }
      return String(col);
    });

    type NextState = UpdateOutput<State, SelectionResult<State, Selections[number]>>;
    const nextState = {
      ...this.state,
      output: {} as SelectionResult<State, Selections[number]>
    } as NextState;

    const nextConfig = {
      ...this.config,
      select: processedColumns,
      orderBy: this.config.orderBy?.map(({ column, direction }) => ({
        column: String(column),
        direction
      }))
    } as QueryConfig<NextState['output'], Schema>;

    return this.fork(nextState, nextConfig);
  }

  selectConst<Selections extends ReadonlyArray<SelectableItem<State>>>(
    ...columns: Selections
  ): QueryBuilder<Schema, UpdateOutput<State, SelectionResult<State, Selections[number]>>> {
    return this.select(columns);
  }

  sum<Column extends keyof BaseRow<State>, Alias extends string = `${Column & string}_sum`>(
    column: Column,
    alias?: Alias
  ): QueryBuilder<Schema, AppendToOutput<State, Record<Alias, string>>> {
    return this.applyAggregation(column, alias, 'sum', (col, finalAlias) =>
      this.aggregations.sum(col, finalAlias)
    );
  }

  count<Column extends keyof BaseRow<State>, Alias extends string = `${Column & string}_count`>(
    column: Column,
    alias?: Alias
  ): QueryBuilder<Schema, AppendToOutput<State, Record<Alias, string>>> {
    return this.applyAggregation(column, alias, 'count', (col, finalAlias) =>
      this.aggregations.count(col, finalAlias)
    );
  }

  avg<Column extends keyof BaseRow<State>, Alias extends string = `${Column & string}_avg`>(
    column: Column,
    alias?: Alias
  ): QueryBuilder<Schema, AppendToOutput<State, Record<Alias, string>>> {
    return this.applyAggregation(column, alias, 'avg', (col, finalAlias) =>
      this.aggregations.avg(col, finalAlias)
    );
  }

  min<Column extends keyof BaseRow<State>, Alias extends string = `${Column & string}_min`>(
    column: Column,
    alias?: Alias
  ): QueryBuilder<Schema, AppendToOutput<State, Record<Alias, string>>> {
    return this.applyAggregation(column, alias, 'min', (col, finalAlias) =>
      this.aggregations.min(col, finalAlias)
    );
  }

  max<Column extends keyof BaseRow<State>, Alias extends string = `${Column & string}_max`>(
    column: Column,
    alias?: Alias
  ): QueryBuilder<Schema, AppendToOutput<State, Record<Alias, string>>> {
    return this.applyAggregation(column, alias, 'max', (col, finalAlias) =>
      this.aggregations.max(col, finalAlias)
    );
  }

  private applyAggregation<Column extends keyof BaseRow<State>, Alias extends string>(
    column: Column,
    alias: Alias | undefined,
    suffix: string,
    updater: (column: string, alias: Alias) => QueryConfig<any, Schema>
  ): QueryBuilder<Schema, AppendToOutput<State, Record<Alias, string>>> {
    const columnName = String(column);
    const finalAlias = (alias || `${columnName}_${suffix}`) as Alias;

    type NextState = AppendToOutput<State, Record<Alias, string>>;
    const nextState = {
      ...this.state,
      output: {} as NextState['output']
    } as NextState;

    const nextConfig = updater(columnName, finalAlias) as QueryConfig<NextState['output'], Schema>;
    return this.fork(nextState, nextConfig);
  }

  // Make needed properties accessible to features
  getTableName() {
    return this.tableName;
  }

  getFormatter() {
    return this.formatter;
  }

  getRuntimeContext() {
    return this.runtime;
  }

  getCacheOptions() {
    return this.cacheOptions;
  }

  getExecutor() {
    return this.executor;
  }

  // Delegate execution methods to feature
  toSQL(): string {
    return this.executor.toSQL();
  }

  toSQLWithParams(): { sql: string, parameters: any[] } {
    return this.executor.toSQLWithParams();
  }

  execute(options?: ExecuteOptions): Promise<State['output'][]> {
    return executeWithCache(this, options);
  }

  async stream(): Promise<ReadableStream<State['output'][]>> {
    return this.executor.stream();
  }

  /**
   * Processes each row in a stream with the provided callback function
   * @param callback Function to call for each row in the stream
   */
  async streamForEach<R = void>(callback: (row: State['output']) => R | Promise<R>): Promise<void> {
    const stream = await this.stream();
    const reader = stream.getReader();

    try {
      while (true) {
        const { done, value: rows } = await reader.read();
        if (done) break;

        for (const row of rows) {
          await callback(row);
        }
      }
    } finally {
      reader.releaseLock();
    }
  }

  private validateFilterValue<Column extends SelectableColumn<State>>(
    column: Column | Column[],
    operator: FilterOperator,
    value: any
  ) {
    // Handle tuple columns
    if (Array.isArray(column)) {
      // For tuple operations, we don't validate individual column types
      // as they might be cross-table references
      return;
    }

    // Skip validation for advanced IN operators - they handle their own validation
    const advancedInOperators = [
      'globalIn', 'globalNotIn', 'inSubquery', 'globalInSubquery',
      'inTable', 'globalInTable', 'inTuple', 'globalInTuple'
    ];
    if (advancedInOperators.includes(operator)) {
      return;
    }

    const columnName = String(column);
    if (FilterValidator.validateJoinedColumn(columnName)) return;

    const baseColumns = this.state.base as Record<string, ColumnType>;
    const columnType = baseColumns[columnName as keyof typeof baseColumns];
    FilterValidator.validateFilterCondition(
      { column: columnName, operator, value },
      columnType
    );
  }

  /**
   * Adds a WHERE clause to filter results.
   * @template K - The column key type
   * @param {K} column - The column to filter on
   * @param {FilterOperator} operator - The comparison operator
   * @param {any} value - The value to compare against
   * @returns {this} The current QueryBuilder instance
   * @example
   * ```ts
   * builder.where('age', 'gt', 18)
   * ```
   */
  where(
    expressionBuilder: (expr: PredicateBuilder<State>) => PredicateExpression
  ): this;
  where<Column extends WhereColumn<State>, Op extends keyof OperatorValueMap<any, Schema>>(
    columnOrColumns: Column | Column[],
    operator: Op,
    value: ColumnOperatorValue<Schema, State, Column, Op>
  ): this;
  /**
   * Adds a WHERE clause for tuple IN operations.
   * @template K - The column keys type
   * @param {K[]} columns - The columns to filter on (for tuple operations)
   * @param {'inTuple' | 'globalInTuple'} operator - The tuple IN operator
   * @param {any} value - The array of tuples to compare against
   * @returns {this} The current QueryBuilder instance
   * @example
   * ```ts
   * builder.where(['counter_id', 'user_id'], 'inTuple', [[34, 123], [101500, 456]])
   * ```
   */
  where<Column extends WhereColumn<State>>(
    columns: Column[],
    operator: 'inTuple' | 'globalInTuple',
    value: any
  ): this;
  where<Column extends WhereColumn<State>, Op extends keyof OperatorValueMap<any, Schema>>(
    columnOrColumns: Column | Column[] | ((expr: PredicateBuilder<State>) => PredicateExpression),
    operator?: Op,
    value?: any
  ): this {
    if (typeof columnOrColumns === 'function') {
      const expression = columnOrColumns(createPredicateBuilder<State>());
      this.config = this.filtering.addExpressionCondition('AND', expression);
      return this;
    }

    if (operator === undefined) {
      throw new Error('Operator is required when specifying a column for where()');
    }

    // Handle tuple operations
    if (Array.isArray(columnOrColumns) && (operator === 'inTuple' || operator === 'globalInTuple')) {
      const columns = columnOrColumns as Column[];
      this.validateFilterValue(columns, operator, value);
      this.config = this.filtering.addCondition('AND', columns.map(String), operator, value);
      return this;
    }

    const column = columnOrColumns as Column;
    this.validateFilterValue(column, operator, value);
    this.config = this.filtering.addCondition('AND', String(column), operator, value);
    return this;
  }

  orWhere(
    expressionBuilder: (expr: PredicateBuilder<State>) => PredicateExpression
  ): this;
  orWhere<Column extends WhereColumn<State>>(
    column: Column,
    operator: FilterOperator,
    value: any
  ): this;
  orWhere<Column extends WhereColumn<State>>(
    columns: Column[],
    operator: 'inTuple' | 'globalInTuple',
    value: any
  ): this;
  orWhere<Column extends WhereColumn<State>>(
    columnOrColumns: Column | Column[] | ((expr: PredicateBuilder<State>) => PredicateExpression),
    operator?: FilterOperator,
    value?: any
  ): this {
    if (typeof columnOrColumns === 'function') {
      const expression = columnOrColumns(createPredicateBuilder<State>());
      this.config = this.filtering.addExpressionCondition('OR', expression);
      return this;
    }

    if (operator === undefined) {
      throw new Error('Operator is required when specifying a column for orWhere()');
    }

    if (Array.isArray(columnOrColumns) && (operator === 'inTuple' || operator === 'globalInTuple')) {
      const columns = columnOrColumns as Column[];
      this.validateFilterValue(columns, operator, value);
      this.config = this.filtering.addCondition('OR', columns.map(String), operator, value);
      return this;
    }

    const column = columnOrColumns as Column;
    this.validateFilterValue(column, operator, value);
    this.config = this.filtering.addCondition('OR', String(column), operator, value);
    return this;
  }

  /**
   * Creates a parenthesized group of WHERE conditions joined with AND/OR operators.
   * @param {Function} callback - Function that builds the conditions within the group
   * @returns {this} The current QueryBuilder instance
   * @example
   * ```ts
   * builder.whereGroup(qb => {
   *   qb.where('status', 'eq', 'active').orWhere('status', 'eq', 'pending');
   * })
   * ```
   */
  whereGroup(callback: (builder: this) => void): this {
    this.config = this.filtering.startWhereGroup();
    callback(this);
    this.config = this.filtering.endWhereGroup();
    return this;
  }

  /**
   * Creates a parenthesized group of WHERE conditions joined with OR operator.
   * @param {Function} callback - Function that builds the conditions within the group
   * @returns {this} The current QueryBuilder instance
   * @example
   * ```ts
   * builder.orWhereGroup(qb => {
   *   qb.where('status', 'eq', 'active').orWhere('status', 'eq', 'pending');
   * })
   * ```
   */
  orWhereGroup(callback: (builder: this) => void): this {
    this.config = this.filtering.startOrWhereGroup();
    callback(this);
    this.config = this.filtering.endWhereGroup();
    return this;
  }

  /**
   * Adds a GROUP BY clause.
   * @param {keyof T | Array<keyof T>} columns - Column(s) to group by
   * @returns {this} The current QueryBuilder instance
   * @example
   * ```ts
   * builder.groupBy(['category', 'status'])
   * ```
   */
  groupBy(columns: SelectableColumn<State> | Array<SelectableColumn<State>>): this {
    const normalized = Array.isArray(columns) ? columns.map(String) : String(columns);
    this.config = this.modifiers.addGroupBy(normalized);
    return this;
  }

  limit(count: number): this {
    this.config = this.modifiers.addLimit(count);
    return this;
  }

  offset(count: number): this {
    this.config = this.modifiers.addOffset(count);
    return this;
  }

  /**
   * Adds an ORDER BY clause.
   * @param {keyof T} column - The column to order by
   * @param {OrderDirection} [direction='ASC'] - The sort direction
   * @returns {this} The current QueryBuilder instance
   * @example
   * ```ts
   * builder.orderBy('created_at', 'DESC')
   * ```
   */
  orderBy(
    column: SelectableColumn<State>,
    direction: OrderDirection = 'ASC'
  ): this {
    this.config = this.modifiers.addOrderBy(String(column), direction);
    return this;
  }

  /**
   * Adds a HAVING clause for filtering grouped results.
   * @param {string} condition - The HAVING condition
   * @returns {this} The current QueryBuilder instance
   * @example
   * ```ts
   * builder.having('COUNT(*) > 5')
   * ```
   */
  having(condition: string, parameters?: any[]): this {
    this.config = this.modifiers.addHaving(condition, parameters);
    return this;
  }

  distinct(): this {
    this.config = this.modifiers.setDistinct();
    return this;
  }

  whereBetween<Column extends keyof BaseRow<State>>(
    column: Column,
    [min, max]: [BaseRow<State>[Column], BaseRow<State>[Column]]
  ): this {
    if (min === null || max === null) {
      throw new Error('BETWEEN values cannot be null');
    }
    return this.where(column, 'between', [min, max] as any);
  }

  innerJoin<TableName extends Extract<keyof Schema, string>, Alias extends string | undefined = undefined>(
    table: TableName,
    leftColumn: keyof BaseRow<State>,
    rightColumn: `${TableName & string}.${keyof Schema[TableName] & string}`,
    alias?: Alias
  ): QueryBuilder<
    Schema,
    Alias extends string
    ? AddAlias<WidenTables<State, TableName>, Alias, TableName>
    : WidenTables<State, TableName>
  > {
    return this.applyJoin('INNER', table, leftColumn, rightColumn, alias);
  }

  leftJoin<TableName extends Extract<keyof Schema, string>, Alias extends string | undefined = undefined>(
    table: TableName,
    leftColumn: keyof BaseRow<State>,
    rightColumn: `${TableName & string}.${keyof Schema[TableName] & string}`,
    alias?: Alias
  ): QueryBuilder<
    Schema,
    Alias extends string
    ? AddAlias<WidenTables<State, TableName>, Alias, TableName>
    : WidenTables<State, TableName>
  > {
    return this.applyJoin('LEFT', table, leftColumn, rightColumn, alias);
  }

  rightJoin<TableName extends Extract<keyof Schema, string>, Alias extends string | undefined = undefined>(
    table: TableName,
    leftColumn: keyof BaseRow<State>,
    rightColumn: `${TableName & string}.${keyof Schema[TableName] & string}`,
    alias?: Alias
  ): QueryBuilder<
    Schema,
    Alias extends string
    ? AddAlias<WidenTables<State, TableName>, Alias, TableName>
    : WidenTables<State, TableName>
  > {
    return this.applyJoin('RIGHT', table, leftColumn, rightColumn, alias);
  }

  fullJoin<TableName extends Extract<keyof Schema, string>, Alias extends string | undefined = undefined>(
    table: TableName,
    leftColumn: keyof BaseRow<State>,
    rightColumn: `${TableName & string}.${keyof Schema[TableName] & string}`,
    alias?: Alias
  ): QueryBuilder<
    Schema,
    Alias extends string
    ? AddAlias<WidenTables<State, TableName>, Alias, TableName>
    : WidenTables<State, TableName>
  > {
    return this.applyJoin('FULL', table, leftColumn, rightColumn, alias);
  }

  private applyJoin<TableName extends Extract<keyof Schema, string>, Alias extends string | undefined = undefined>(
    type: JoinType,
    table: TableName,
    leftColumn: keyof BaseRow<State>,
    rightColumn: `${TableName & string}.${keyof Schema[TableName] & string}`,
    alias?: Alias
  ): QueryBuilder<
    Schema,
    Alias extends string
    ? AddAlias<WidenTables<State, TableName>, Alias, TableName>
    : WidenTables<State, TableName>
  > {
    type JoinedState = WidenTables<State, TableName>;
    type NextState = Alias extends string ? AddAlias<JoinedState, Alias, TableName> : JoinedState;

    const nextState = {
      ...this.state,
      aliases: alias ? { ...this.state.aliases, [alias]: table } : this.state.aliases
    } as unknown as NextState;

    const nextConfig = this.joins.addJoin(type, table, String(leftColumn), rightColumn, alias) as QueryConfig<NextState['output'], Schema>;
    return this.fork<NextState>(nextState, nextConfig);
  }

  // Make config accessible to features
  getConfig() {
    return this.config;
  }

  /**
   * Paginates the query results using cursor-based pagination
   */
  async paginate(options: PaginationOptions<State['output']>): Promise<PaginatedResult<State['output']>> {
    return this.pagination.paginate(options);
  }

  /**
   * Gets the first page of results
   */
  async firstPage(pageSize: number): Promise<PaginatedResult<State['output']>> {
    return this.pagination.firstPage(pageSize);
  }

  /**
   * Returns an async iterator that yields all pages
   */
  iteratePages(pageSize: number): AsyncGenerator<PaginatedResult<State['output']>> {
    return this.pagination.iteratePages(pageSize);
  }

  static setJoinRelationships<S extends SchemaDefinition<S>>(
    relationships: JoinRelationships<S>
  ): void {
    this.relationships = relationships;
  }

  /**
   * Apply a predefined join relationship
   */
  withRelation(name: string, options?: JoinPathOptions): this {
    if (!QueryBuilder.relationships) {
      throw new Error('Join relationships have not been initialized. Call QueryBuilder.setJoinRelationships first.');
    }

    const path = QueryBuilder.relationships.get(name);
    if (!path) {
      throw new Error(`Join relationship '${name}' not found`);
    }

    if (Array.isArray(path)) {
      // Handle join chain
      path.forEach(joinPath => {
        const type = options?.type || joinPath.type || 'INNER';
        const alias = options?.alias || joinPath.alias;
        const table = String(joinPath.to) as Extract<keyof Schema, string>;
        const rightColumn = `${table}.${joinPath.rightColumn}` as `${typeof table}.${keyof Schema[typeof table] & string}`;
        this.config = this.joins.addJoin(type, table, joinPath.leftColumn as any, rightColumn, alias);
      });
    } else {
      // Handle single join
      const type = options?.type || path.type || 'INNER';
      const alias = options?.alias || path.alias;
      const table = String(path.to) as Extract<keyof Schema, string>;
      const rightColumn = `${table}.${path.rightColumn}` as `${typeof table}.${keyof Schema[typeof table] & string}`;
      this.config = this.joins.addJoin(type, table, path.leftColumn as any, rightColumn, alias);
    }

    return this;
  }
}

export type SelectQB<
  Schema extends SchemaDefinition<Schema>,
  Tables extends string,
  Output,
  BaseTable extends keyof Schema
> = QueryBuilder<Schema, BuilderState<Schema, Tables, Output, BaseTable, {}>>;

export type CreateQueryBuilderConfig = ClickHouseConfig & {
  cache?: CacheConfig;
};

function deriveNamespace(config: ClickHouseConfig): string {
  if (isClientConfig(config)) {
    return 'client';
  }
  const host = 'host' in config ? config.host : 'unknown-host';
  const database = 'database' in config ? config.database : 'default';
  const username = 'username' in config ? config.username : 'default';
  return `${host || 'unknown-host'}|${database || 'default'}|${username || 'default'}`;
}

export function createQueryBuilder<Schema extends SchemaDefinition<Schema>>(
  config: CreateQueryBuilderConfig
) {
  const { cache: cacheConfig, ...connectionConfig } = config as ClickHouseConfig & { cache?: CacheConfig };
  ClickHouseConnection.initialize(connectionConfig as ClickHouseConfig);

  const namespace = cacheConfig?.namespace || deriveNamespace(connectionConfig as ClickHouseConfig);
  const provider = cacheConfig?.provider ?? (cacheConfig ? new MemoryCacheProvider() : undefined);
  const mergedCacheConfig = cacheConfig
    ? { ...cacheConfig, namespace, provider }
    : { namespace, provider } as CacheConfig;
  const runtimeConfig = resolveCacheConfig(mergedCacheConfig, namespace);
  const runtime = buildRuntimeContext(runtimeConfig);
  const cacheController = new CacheController(runtime);

  return {
    cache: cacheController,
    table<TableName extends Extract<keyof Schema, string>>(tableName: TableName): SelectQB<
      Schema,
      TableName,
      InitialState<Schema, TableName>['output'],
      TableName
    > {
      const state = {
        schema: {} as Schema,
        tables: tableName,
        output: {} as InitialState<Schema, TableName>['output'],
        baseTable: tableName,
        base: {} as Schema[TableName],
        aliases: {} as Partial<Record<string, keyof Schema>>
      } as InitialState<Schema, TableName>;

      return new QueryBuilder<Schema, typeof state>(tableName as string, state, runtime);
    }
  };
}
