import { ClickHouseConnection } from './connection.js';
import { CrossFilter } from './cross-filter.js';
import {
  ColumnType,
  InferClickHouseType,
  FilterOperator,
  OrderDirection,
  TableColumn,
  AggregationType,
  QueryConfig,
  OperatorValueMap,
  InferColumnType,
  PaginationOptions,
  PaginatedResult,
} from '../types/index.js';
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
import { CrossFilteringFeature } from './features/cross-filtering.js';
import type { ClickHouseSettings, BaseClickHouseClientConfigOptions } from '@clickhouse/client-common';
import type { ClickHouseClient as NodeClickHouseClient } from '@clickhouse/client';
import type { ClickHouseClient as WebClickHouseClient } from '@clickhouse/client-web';

// Union type that accepts either client type
type ClickHouseClient = NodeClickHouseClient | WebClickHouseClient;

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
  return 'client' in config && !('host' in config);
}

/**
 * A type-safe query builder for ClickHouse databases.
 * @template Schema - The full database schema
 * @template T - The schema type of the current table
 * @template HasSelect - Whether a SELECT clause has been applied
 * @template Aggregations - The type of any aggregation functions applied
 */
export class QueryBuilder<
  Schema extends { [K in keyof Schema]: { [columnName: string]: ColumnType } },
  T,
  HasSelect extends boolean = false,
  Aggregations = {},
  OriginalT = T
> {
  private static relationships: JoinRelationships<any>;

  private config: QueryConfig<T, Schema> = {};
  private tableName: string;
  private schema: { name: string; columns: T };
  private originalSchema: Schema;
  private formatter = new SQLFormatter();
  private aggregations: AggregationFeature<Schema, T, HasSelect, Aggregations, OriginalT>;
  private joins: JoinFeature<Schema, T, HasSelect, Aggregations, OriginalT>;
  private filtering: FilteringFeature<Schema, T, HasSelect, Aggregations, OriginalT>;
  private analytics: AnalyticsFeature<Schema, T, HasSelect, Aggregations, OriginalT>;
  private executor: ExecutorFeature<Schema, T, HasSelect, Aggregations, OriginalT>;
  private modifiers: QueryModifiersFeature<Schema, T, HasSelect, Aggregations, OriginalT>;
  private pagination: PaginationFeature<Schema, T, HasSelect, Aggregations, OriginalT>;
  private crossFiltering: CrossFilteringFeature<Schema, T, HasSelect, Aggregations, OriginalT>;

  constructor(
    tableName: string,
    schema: { name: string; columns: T },
    originalSchema: Schema
  ) {
    this.tableName = tableName;
    this.schema = schema;
    this.originalSchema = originalSchema
    this.aggregations = new AggregationFeature(this);
    this.joins = new JoinFeature(this);
    this.filtering = new FilteringFeature(this);
    this.analytics = new AnalyticsFeature(this);
    this.executor = new ExecutorFeature(this);
    this.modifiers = new QueryModifiersFeature(this);
    this.pagination = new PaginationFeature(this);
    this.crossFiltering = new CrossFilteringFeature(this);
  }

  debug() {
    console.log('Current Type:', {
      schema: this.schema,
      originalSchema: this.originalSchema,
      config: this.config
    });
    return this;
  }

  clone(): QueryBuilder<Schema, T, HasSelect, Aggregations, OriginalT> {
    const newBuilder = new QueryBuilder<Schema, T, HasSelect, Aggregations, OriginalT>(
      this.tableName,
      this.schema,
      this.originalSchema
    );
    newBuilder.config = { ...this.config };
    // Initialize features with the new builder
    newBuilder.aggregations = new AggregationFeature(newBuilder);
    newBuilder.joins = new JoinFeature(newBuilder);
    newBuilder.filtering = new FilteringFeature(newBuilder);
    newBuilder.analytics = new AnalyticsFeature(newBuilder);
    newBuilder.executor = new ExecutorFeature(newBuilder);
    newBuilder.modifiers = new QueryModifiersFeature(newBuilder);
    newBuilder.pagination = new PaginationFeature(newBuilder);
    newBuilder.crossFiltering = new CrossFilteringFeature(newBuilder);
    return newBuilder as any;
  }

  // --- Analytics Helper: Add a CTE.
  withCTE(alias: string, subquery: QueryBuilder<any, any> | string): this {
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
    column: keyof T | TableColumn<Schema>,
    interval: string,
    method: 'toStartOfInterval' | 'toStartOfMinute' | 'toStartOfHour' | 'toStartOfDay' | 'toStartOfWeek' | 'toStartOfMonth' | 'toStartOfQuarter' | 'toStartOfYear' = 'toStartOfInterval'
  ): this {
    this.config = this.analytics.addTimeInterval(column, interval, method);
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
  applyCrossFilters(crossFilter: CrossFilter<Schema, keyof Schema>): this {
    this.config = this.crossFiltering.applyCrossFilters(crossFilter);
    return this;
  }

  /**
   * Selects specific columns from the table.
   * @template K - The keys/columns to select
   * @param {K[]} columns - Array of column names to select
   * @returns {QueryBuilder} A new QueryBuilder instance with updated types
   * @example
   * ```ts
   * builder.select(['id', 'name'])
   * ```
   */
  select<K extends keyof T | TableColumn<Schema> | SqlExpression>(
    columns: K[]
  ): QueryBuilder<
    Schema,
    {
      [P in Extract<K, keyof T | TableColumn<Schema>> as P extends `${string}.${infer C}` ? C : P]:
      P extends keyof T
      ? T[P] extends ColumnType
      ? InferClickHouseType<T[P]>
      : unknown
      : string
    },
    true,
    Aggregations,
    OriginalT
  > {
    // Create a new builder with the appropriate type parameters
    const newBuilder = new QueryBuilder<
      Schema,
      {
        [P in Extract<K, keyof T | TableColumn<Schema>> as P extends `${string}.${infer C}` ? C : P]:
        P extends keyof T
        ? T[P] extends ColumnType
        ? InferClickHouseType<T[P]>
        : unknown
        : string
      },
      true,
      Aggregations,
      OriginalT
    >(
      this.tableName,
      {
        name: this.schema.name,
        columns: {} as any
      },
      this.originalSchema
    );

    // Process columns array to handle SqlExpressions and convert to strings
    const processedColumns = columns.map(col => {
      if (typeof col === 'object' && col !== null && '__type' in col) {
        return (col as SqlExpression).toSql();
      }
      return String(col);
    });

    newBuilder.config = {
      ...this.config,
      select: processedColumns,
      orderBy: this.config.orderBy?.map(({ column, direction }) => ({
        column: String(column) as any,
        direction
      }))
    };
    return newBuilder as any
  }

  sum<Column extends keyof OriginalT, Alias extends string = `${Column & string}_sum`>(
    column: Column,
    alias?: Alias
  ): QueryBuilder<
    Schema,
    AggregationType<T, Aggregations, Column, Alias, 'sum', HasSelect>,
    true,
    {},
    OriginalT
  > {
    const newBuilder = this.clone();
    newBuilder.config = this.aggregations.sum(column, alias);
    return newBuilder as any
  }

  count<Column extends keyof OriginalT, Alias extends string = `${Column & string}_count`>(
    column: Column,
    alias?: Alias
  ): QueryBuilder<
    Schema,
    AggregationType<T, Aggregations, Column, Alias, 'count', HasSelect>,
    true,
    {},
    OriginalT
  > {
    const newBuilder = this.clone();
    newBuilder.config = this.aggregations.count(column, alias);
    return newBuilder as any
  }

  avg<Column extends keyof OriginalT, Alias extends string = `${Column & string}_avg`>(
    column: Column,
    alias?: Alias
  ): QueryBuilder<
    Schema,
    AggregationType<T, Aggregations, Column, Alias, 'avg', HasSelect>,
    true,
    {},
    OriginalT
  > {
    const newBuilder = this.clone();
    newBuilder.config = this.aggregations.avg(column, alias);
    return newBuilder as any
  }

  min<Column extends keyof OriginalT, Alias extends string = `${Column & string}_min`>(
    column: Column,
    alias?: Alias
  ): QueryBuilder<
    Schema,
    AggregationType<T, Aggregations, Column, Alias, 'min', HasSelect>,
    true,
    {},
    OriginalT
  > {
    const newBuilder = this.clone();
    newBuilder.config = this.aggregations.min(column, alias);
    return newBuilder as any
  }

  max<Column extends keyof OriginalT, Alias extends string = `${Column & string}_max`>(
    column: Column,
    alias?: Alias
  ): QueryBuilder<
    Schema,
    AggregationType<T, Aggregations, Column, Alias, 'max', HasSelect>,
    true,
    {},
    OriginalT
  > {
    const newBuilder = this.clone();
    newBuilder.config = this.aggregations.max(column, alias);
    return newBuilder as any
  }

  // Make needed properties accessible to features
  getTableName() {
    return this.tableName;
  }

  getFormatter() {
    return this.formatter;
  }

  // Delegate execution methods to feature
  toSQL(): string {
    return this.executor.toSQL();
  }

  toSQLWithParams(): { sql: string, parameters: any[] } {
    return this.executor.toSQLWithParams();
  }

  execute(): Promise<T[]> {
    return this.executor.execute();
  }

  async stream(): Promise<ReadableStream<T[]>> {
    return this.executor.stream();
  }

  /**
   * Processes each row in a stream with the provided callback function
   * @param callback Function to call for each row in the stream
   */
  async streamForEach<R = void>(callback: (row: T) => R | Promise<R>): Promise<void> {
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

  private validateFilterValue<K extends keyof OriginalT | TableColumn<Schema>>(
    column: K | K[],
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

    if (FilterValidator.validateJoinedColumn(String(column))) return;

    const columnType = this.schema.columns[column as keyof T] as ColumnType;
    FilterValidator.validateFilterCondition(
      { column: String(column), operator, value },
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
  where<K extends keyof OriginalT | TableColumn<Schema>, Op extends keyof OperatorValueMap<any, Schema>>(
    columnOrColumns: K | K[],
    operator: Op,
    value: K extends keyof OriginalT
      ? OperatorValueMap<OriginalT[K] extends ColumnType ? InferColumnType<OriginalT[K]> : never, Schema>[Op]
      : any
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
  where<K extends keyof OriginalT | TableColumn<Schema>>(
    columns: K[],
    operator: 'inTuple' | 'globalInTuple',
    value: any
  ): this;
  where<K extends keyof OriginalT | TableColumn<Schema>, Op extends keyof OperatorValueMap<any>>(
    columnOrColumns: K | K[],
    operator: Op,
    value: any
  ): this {
    // Handle tuple operations
    if (Array.isArray(columnOrColumns) && (operator === 'inTuple' || operator === 'globalInTuple')) {
      // For tuple operations, we need to handle the column array specially
      const columns = columnOrColumns as K[];
      this.validateFilterValue(columns, operator, value);
      this.config = this.filtering.addCondition('AND', columns, operator, value);
      return this;
    }

    // Handle regular operations
    const column = columnOrColumns as K;
    this.validateFilterValue(column, operator, value);
    this.config = this.filtering.addCondition('AND', column, operator, value);
    return this;
  }

  orWhere<K extends keyof OriginalT | TableColumn<Schema>>(
    column: K,
    operator: FilterOperator,
    value: any
  ): this;
  /**
   * Adds an OR WHERE clause for tuple IN operations.
   * @template K - The column keys type
   * @param {K[]} columns - The columns to filter on (for tuple operations)
   * @param {'inTuple' | 'globalInTuple'} operator - The tuple IN operator
   * @param {any} value - The array of tuples to compare against
   * @returns {this} The current QueryBuilder instance
   * @example
   * ```ts
   * builder.orWhere(['counter_id', 'user_id'], 'inTuple', [[34, 123], [101500, 456]])
   * ```
   */
  orWhere<K extends keyof OriginalT | TableColumn<Schema>>(
    columns: K[],
    operator: 'inTuple' | 'globalInTuple',
    value: any
  ): this;
  orWhere<K extends keyof OriginalT | TableColumn<Schema>>(
    columnOrColumns: K | K[],
    operator: FilterOperator,
    value: any
  ): this {
    // Handle tuple operations
    if (Array.isArray(columnOrColumns) && (operator === 'inTuple' || operator === 'globalInTuple')) {
      // For tuple operations, we need to handle the column array specially
      const columns = columnOrColumns as K[];
      this.validateFilterValue(columns, operator, value);
      this.config = this.filtering.addCondition('OR', columns, operator, value);
      return this;
    }

    // Handle regular operations
    const column = columnOrColumns as K;
    this.validateFilterValue(column, operator, value);
    this.config = this.filtering.addCondition('OR', column, operator, value);
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
  groupBy(columns: (keyof T | TableColumn<Schema>) | Array<keyof T | TableColumn<Schema>>): this {
    this.config = this.modifiers.addGroupBy(columns);
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
  orderBy<K extends keyof T | TableColumn<Schema>>(
    column: K,
    direction: OrderDirection = 'ASC'
  ): this {
    this.config = this.modifiers.addOrderBy(column, direction);
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

  whereBetween<K extends keyof OriginalT>(
    column: K,
    [min, max]: [
      OriginalT[K] extends ColumnType ? InferColumnType<OriginalT[K]> : never,
      OriginalT[K] extends ColumnType ? InferColumnType<OriginalT[K]> : never
    ]
  ): this {
    if (min === null || max === null) {
      throw new Error('BETWEEN values cannot be null');
    }
    return this.where(column, 'between', [min, max] as any);
  }

  innerJoin<TableName extends keyof Schema>(
    table: TableName,
    leftColumn: keyof OriginalT,
    rightColumn: `${TableName & string}.${keyof Schema[TableName] & string}`,
    alias?: string
  ): QueryBuilder<Schema, T, HasSelect, Aggregations, OriginalT> {
    const newBuilder = this.clone();
    newBuilder.config = this.joins.addJoin('INNER', table, leftColumn, rightColumn, alias);
    return newBuilder;
  }

  leftJoin<
    TableName extends keyof Schema
  >(
    table: TableName,
    leftColumn: keyof OriginalT,
    rightColumn: `${TableName & string}.${keyof Schema[TableName] & string}`,
    alias?: string
  ): QueryBuilder<Schema, T, HasSelect, Aggregations, OriginalT> {
    const newBuilder = this.clone();
    newBuilder.config = this.joins.addJoin('LEFT', table, leftColumn, rightColumn, alias);
    return newBuilder as any
  }

  rightJoin<
    TableName extends keyof Schema  // The table we're joining to
  >(
    table: TableName,
    leftColumn: keyof OriginalT,
    rightColumn: `${TableName & string}.${keyof Schema[TableName] & string}`,
    alias?: string
  ): QueryBuilder<Schema, T, HasSelect, Aggregations, OriginalT> {
    const newBuilder = this.clone();
    newBuilder.config = this.joins.addJoin('RIGHT', table, leftColumn, rightColumn, alias);
    return newBuilder as any
  }

  fullJoin<
    TableName extends keyof Schema
  >(
    table: TableName,
    leftColumn: keyof OriginalT,
    rightColumn: `${TableName & string}.${keyof Schema[TableName] & string}`,
    alias?: string
  ): QueryBuilder<Schema, T, HasSelect, Aggregations, OriginalT> {
    const newBuilder = this.clone();
    newBuilder.config = this.joins.addJoin('FULL', table, leftColumn, rightColumn, alias);
    return newBuilder as any
  }

  // Make config accessible to features
  getConfig() {
    return this.config;
  }

  /**
   * Paginates the query results using cursor-based pagination
   */
  async paginate(options: PaginationOptions<T>): Promise<PaginatedResult<T>> {
    return this.pagination.paginate(options);
  }

  /**
   * Gets the first page of results
   */
  async firstPage(pageSize: number): Promise<PaginatedResult<T>> {
    return this.pagination.firstPage(pageSize);
  }

  /**
   * Returns an async iterator that yields all pages
   */
  iteratePages(pageSize: number): AsyncGenerator<PaginatedResult<T>> {
    return this.pagination.iteratePages(pageSize);
  }

  static setJoinRelationships<S extends { [K in keyof S]: { [columnName: string]: ColumnType } }>(
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
        this.config = this.joins.addJoin(type, table, joinPath.leftColumn as any, `${table}.${joinPath.rightColumn}`, alias);
      });
    } else {
      // Handle single join
      const type = options?.type || path.type || 'INNER';
      const alias = options?.alias || path.alias;
      const table = String(path.to) as Extract<keyof Schema, string>;
      this.config = this.joins.addJoin(type, table, path.leftColumn as any, `${table}.${path.rightColumn}`, alias);
    }

    return this;
  }
}

export function createQueryBuilder<Schema extends {
  [K in keyof Schema]: { [columnName: string]: ColumnType }
}>(
  config: ClickHouseConfig
) {
  ClickHouseConnection.initialize(config);

  return {
    table<TableName extends keyof Schema>(tableName: TableName): QueryBuilder<Schema, Schema[TableName], false, {}> {
      return new QueryBuilder<Schema, Schema[TableName], false, {}>(
        tableName as string,
        {
          name: tableName as string,
          columns: {} as Schema[TableName]
        },
        {} as Schema
      );
    }
  };
}