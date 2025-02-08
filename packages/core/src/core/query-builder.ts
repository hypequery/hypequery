import { ClickHouseConnection } from './connection';
import { CrossFilter } from './cross-filter';
import {
  ColumnType,
  FilterOperator,
  OrderDirection,
  TableColumn,
  AggregationType,
  QueryConfig,
  OperatorValueMap,
  InferColumnType,
  FilterConditionInput
} from '../types';
import { ClickHouseSettings } from '@clickhouse/client-web'
import { SQLFormatter } from './formatters/sql-formatter';
import { AggregationFeature } from './features/aggregations';
import { JoinFeature } from './features/joins';
import { FilteringFeature } from './features/filtering';
import { AnalyticsFeature } from './features/analytics';
import { ExecutorFeature } from './features/executor';
import { QueryModifiersFeature } from './features/query-modifiers';
import { ValueValidator } from './validators/value-validator';
import { FilterValidator } from './validators/filter-validator';

/**
 * A type-safe query builder for ClickHouse databases.
 * @template Schema - The full database schema
 * @template T - The schema type of the current table
 * @template HasSelect - Whether a SELECT clause has been applied
 * @template Aggregations - The type of any aggregation functions applied
 */
export class QueryBuilder<
  Schema extends { [tableName: string]: { [columnName: string]: ColumnType } },
  T,
  HasSelect extends boolean = false,
  Aggregations = {},
  OriginalT = T
> {
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
  }

  debug() {
    console.log('Current Type:', {
      schema: this.schema,
      originalSchema: this.originalSchema,
      config: this.config
    });
    return this;
  }

  private clone(): QueryBuilder<Schema, T, HasSelect, Aggregations, OriginalT> {
    const newBuilder = new QueryBuilder(
      this.tableName,
      this.schema,
      this.originalSchema
    );
    newBuilder.config = { ...this.config };
    return newBuilder as any
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
  applyCrossFilters(crossFilter: CrossFilter): this {
    crossFilter.getConditions().forEach((condition: FilterConditionInput<any>) => {
      this.where(condition.column, condition.operator, condition.value);
    });
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
  select<K extends keyof T | TableColumn<Schema>>(columns: K[]): QueryBuilder<Schema, {
    [P in K as P extends `${string}.${infer C}` ? C : P]: P extends keyof T
    ? (
      T[P] extends "String" ? string :
      T[P] extends "Date" ? Date :
      T[P] extends "Float64" | "Int32" | "Int64" ? number : never
    ) : string;
  }, true, Aggregations, OriginalT> {
    type NewT = {
      [P in K as P extends `${string}.${infer C}` ? C : P]: P extends keyof T ? (
        T[P] extends "String" ? string :
        T[P] extends "Date" ? Date :
        T[P] extends "Float64" | "Int32" | "Int64" ? number : never
      ) : string;
    }

    const newBuilder = new QueryBuilder<Schema, NewT, true, Aggregations, OriginalT>(
      this.tableName,
      { name: this.schema.name, columns: {} as NewT },
      this.originalSchema
    );
    newBuilder.config = {
      ...this.config,
      select: columns.map(String),
      orderBy: this.config.orderBy?.map(({ column, direction }) => ({
        column: String(column) as keyof NewT | TableColumn<Schema>,
        direction
      }))
    };
    return newBuilder as any;
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
    return newBuilder as any;
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
    return newBuilder as any;
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
    return newBuilder as any;
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
    return newBuilder as any;
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
    return newBuilder as any;
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


  private validateFilterValue<K extends keyof OriginalT | TableColumn<Schema>>(
    column: K,
    operator: FilterOperator,
    value: any
  ) {
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
  where<K extends keyof OriginalT | TableColumn<Schema>, Op extends keyof OperatorValueMap<any>>(
    column: K,
    operator: Op,
    value: K extends keyof OriginalT
      ? OperatorValueMap<OriginalT[K] extends ColumnType ? InferColumnType<OriginalT[K]> : never>[Op]
      : any
  ): this {
    this.validateFilterValue(column, operator, value);

    this.config = this.filtering.addCondition('AND', column, operator, value);
    return this;
  }

  orWhere<K extends keyof OriginalT | TableColumn<Schema>>(
    column: K,
    operator: FilterOperator,
    value: any
  ): this {
    this.config = this.filtering.addCondition('OR', column, operator, value);
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
    return newBuilder as any;
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
    return newBuilder as any;
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
    return newBuilder as any;
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
    return newBuilder as any;
  }

  // Make config accessible to features
  getConfig() {
    return this.config;
  }

}

export function createQueryBuilder<Schema extends {
  [K in keyof Schema]: { [columnName: string]: ColumnType }
}>(
  config: {
    host: string;
    username?: string;
    password?: string;
    database?: string;
  }
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