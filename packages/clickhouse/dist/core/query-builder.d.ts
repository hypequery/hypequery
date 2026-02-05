import { CrossFilter } from './cross-filter.js';
import { FilterOperator, OperatorValueMap, OrderDirection, QueryConfig } from '../types/index.js';
import { AnySchema } from '../types/schema.js';
import { SQLFormatter } from './formatters/sql-formatter.js';
import { ExecutorFeature } from './features/executor.js';
import { JoinRelationships, JoinPathOptions } from './join-relationships.js';
import { PredicateBuilder, PredicateExpression } from './utils/predicate-builder.js';
import type { ClickHouseSettings, BaseClickHouseClientConfigOptions } from '@clickhouse/client-common';
import type { ClickHouseClient as NodeClickHouseClient } from '@clickhouse/client';
import type { ClickHouseClient as WebClickHouseClient } from '@clickhouse/client-web';
import type { CacheOptions, CacheConfig } from './cache/types.js';
import type { QueryRuntimeContext } from './cache/runtime-context.js';
import type { BuilderState, AnyBuilderState, SchemaDefinition, InitialState, UpdateOutput, WidenTables, AppendToOutput, BaseRow, AddAlias } from './types/builder-state.js';
import { SelectableItem, SelectableColumn, SelectionResult, ColumnSelectionValue } from './types/select-types.js';
type WhereColumn<State extends AnyBuilderState> = SelectableColumn<State>;
type ColumnOperatorValue<Schema extends SchemaDefinition<Schema>, State extends BuilderState<Schema, string, any, keyof Schema, Partial<Record<string, keyof Schema>>>, Column extends WhereColumn<State>, Op extends keyof OperatorValueMap<any, Schema>> = OperatorValueMap<ColumnSelectionValue<State, Column>, Schema>[Op];
type ClickHouseClient = NodeClickHouseClient | WebClickHouseClient;
export interface ExecuteOptions {
    queryId?: string;
    cache?: CacheOptions | false;
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
export declare function isClientConfig(config: ClickHouseConfig): config is ClickHouseClientConfig;
/**
 * A type-safe query builder for ClickHouse databases.
 * The builder carries a single state object that encodes scope, output, and schema metadata.
 */
export declare class QueryBuilder<Schema extends SchemaDefinition<Schema>, State extends BuilderState<Schema, string, any, keyof Schema, Partial<Record<string, keyof Schema>>>> {
    private static relationships;
    private config;
    private tableName;
    private state;
    private formatter;
    private aggregations;
    private joins;
    private filtering;
    private analytics;
    private executor;
    private modifiers;
    private crossFiltering;
    private runtime;
    private cacheOptions?;
    constructor(tableName: string, state: State, runtime: QueryRuntimeContext);
    private fork;
    debug(): this;
    cache(options: CacheOptions | false): this;
    withCTE(alias: string, subquery: QueryBuilder<any, AnyBuilderState> | string): this;
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
    groupByTimeInterval(column: SelectableColumn<State>, interval: string, method?: 'toStartOfInterval' | 'toStartOfMinute' | 'toStartOfHour' | 'toStartOfDay' | 'toStartOfWeek' | 'toStartOfMonth' | 'toStartOfQuarter' | 'toStartOfYear'): this;
    raw(sql: string): this;
    settings(opts: ClickHouseSettings): this;
    /**
     * Applies a set of cross filters to the current query.
     * All filter conditions from the provided CrossFilter are added to the query.
     * @param crossFilter - An instance of CrossFilter containing shared filter conditions.
     * @returns The current QueryBuilder instance.
     */
    applyCrossFilters<TableName extends Extract<keyof Schema, string>>(crossFilter: CrossFilter<Schema, TableName>): this;
    applyCrossFilters(crossFilter: CrossFilter<AnySchema, string>): this;
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
    select<Selections extends ReadonlyArray<SelectableItem<State>>>(columnsOrAsterisk: Selections): QueryBuilder<Schema, UpdateOutput<State, SelectionResult<State, Selections[number]>>>;
    selectConst<Selections extends ReadonlyArray<SelectableItem<State>>>(...columns: Selections): QueryBuilder<Schema, UpdateOutput<State, SelectionResult<State, Selections[number]>>>;
    sum<Column extends keyof BaseRow<State>, Alias extends string = `${Column & string}_sum`>(column: Column, alias?: Alias): QueryBuilder<Schema, AppendToOutput<State, Record<Alias, string>>>;
    count<Column extends keyof BaseRow<State>, Alias extends string = `${Column & string}_count`>(column: Column, alias?: Alias): QueryBuilder<Schema, AppendToOutput<State, Record<Alias, string>>>;
    avg<Column extends keyof BaseRow<State>, Alias extends string = `${Column & string}_avg`>(column: Column, alias?: Alias): QueryBuilder<Schema, AppendToOutput<State, Record<Alias, string>>>;
    min<Column extends keyof BaseRow<State>, Alias extends string = `${Column & string}_min`>(column: Column, alias?: Alias): QueryBuilder<Schema, AppendToOutput<State, Record<Alias, string>>>;
    max<Column extends keyof BaseRow<State>, Alias extends string = `${Column & string}_max`>(column: Column, alias?: Alias): QueryBuilder<Schema, AppendToOutput<State, Record<Alias, string>>>;
    private applyAggregation;
    getTableName(): string;
    getFormatter(): SQLFormatter;
    getRuntimeContext(): QueryRuntimeContext;
    getCacheOptions(): CacheOptions | undefined;
    getExecutor(): ExecutorFeature<Schema, State>;
    toSQL(): string;
    toSQLWithParams(): {
        sql: string;
        parameters: any[];
    };
    execute(options?: ExecuteOptions): Promise<State['output'][]>;
    stream(): Promise<ReadableStream<State['output'][]>>;
    /**
     * Processes each row in a stream with the provided callback function
     * @param callback Function to call for each row in the stream
     */
    streamForEach<R = void>(callback: (row: State['output']) => R | Promise<R>): Promise<void>;
    private validateFilterValue;
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
    where(expressionBuilder: (expr: PredicateBuilder<State>) => PredicateExpression): this;
    where<Column extends WhereColumn<State>, Op extends keyof OperatorValueMap<any, Schema>>(columnOrColumns: Column | Column[], operator: Op, value: ColumnOperatorValue<Schema, State, Column, Op>): this;
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
    where<Column extends WhereColumn<State>>(columns: Column[], operator: 'inTuple' | 'globalInTuple', value: any): this;
    orWhere(expressionBuilder: (expr: PredicateBuilder<State>) => PredicateExpression): this;
    orWhere<Column extends WhereColumn<State>>(column: Column, operator: FilterOperator, value: any): this;
    orWhere<Column extends WhereColumn<State>>(columns: Column[], operator: 'inTuple' | 'globalInTuple', value: any): this;
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
    whereGroup(callback: (builder: this) => void): this;
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
    orWhereGroup(callback: (builder: this) => void): this;
    /**
     * Adds a GROUP BY clause.
     * @param {keyof T | Array<keyof T>} columns - Column(s) to group by
     * @returns {this} The current QueryBuilder instance
     * @example
     * ```ts
     * builder.groupBy(['category', 'status'])
     * ```
     */
    groupBy(columns: SelectableColumn<State> | Array<SelectableColumn<State>>): this;
    limit(count: number): this;
    offset(count: number): this;
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
    orderBy(column: SelectableColumn<State>, direction?: OrderDirection): this;
    /**
     * Adds a HAVING clause for filtering grouped results.
     * @param {string} condition - The HAVING condition
     * @returns {this} The current QueryBuilder instance
     * @example
     * ```ts
     * builder.having('COUNT(*) > 5')
     * ```
     */
    having(condition: string, parameters?: any[]): this;
    distinct(): this;
    whereBetween<Column extends keyof BaseRow<State>>(column: Column, [min, max]: [BaseRow<State>[Column], BaseRow<State>[Column]]): this;
    innerJoin<TableName extends Extract<keyof Schema, string>, Alias extends string | undefined = undefined>(table: TableName, leftColumn: keyof BaseRow<State>, rightColumn: `${TableName & string}.${keyof Schema[TableName] & string}`, alias?: Alias): QueryBuilder<Schema, Alias extends string ? AddAlias<WidenTables<State, TableName>, Alias, TableName> : WidenTables<State, TableName>>;
    leftJoin<TableName extends Extract<keyof Schema, string>, Alias extends string | undefined = undefined>(table: TableName, leftColumn: keyof BaseRow<State>, rightColumn: `${TableName & string}.${keyof Schema[TableName] & string}`, alias?: Alias): QueryBuilder<Schema, Alias extends string ? AddAlias<WidenTables<State, TableName>, Alias, TableName> : WidenTables<State, TableName>>;
    rightJoin<TableName extends Extract<keyof Schema, string>, Alias extends string | undefined = undefined>(table: TableName, leftColumn: keyof BaseRow<State>, rightColumn: `${TableName & string}.${keyof Schema[TableName] & string}`, alias?: Alias): QueryBuilder<Schema, Alias extends string ? AddAlias<WidenTables<State, TableName>, Alias, TableName> : WidenTables<State, TableName>>;
    fullJoin<TableName extends Extract<keyof Schema, string>, Alias extends string | undefined = undefined>(table: TableName, leftColumn: keyof BaseRow<State>, rightColumn: `${TableName & string}.${keyof Schema[TableName] & string}`, alias?: Alias): QueryBuilder<Schema, Alias extends string ? AddAlias<WidenTables<State, TableName>, Alias, TableName> : WidenTables<State, TableName>>;
    private applyJoin;
    getConfig(): QueryConfig<State["output"], Schema>;
    static setJoinRelationships<S extends SchemaDefinition<S>>(relationships: JoinRelationships<S>): void;
    /**
     * Apply a predefined join relationship
     */
    withRelation(name: string, options?: JoinPathOptions): this;
}
export type SelectQB<Schema extends SchemaDefinition<Schema>, Tables extends string, Output, BaseTable extends keyof Schema> = QueryBuilder<Schema, BuilderState<Schema, Tables, Output, BaseTable, {}>>;
export type CreateQueryBuilderConfig = ClickHouseConfig & {
    cache?: CacheConfig;
};
export declare function createQueryBuilder<Schema extends SchemaDefinition<Schema>>(config: CreateQueryBuilderConfig): {
    cache: import("./cache/controller.js").CacheController;
    rawQuery<TResult = any>(sql: string, params?: unknown[]): Promise<TResult[][]>;
    table<TableName extends Extract<keyof Schema, string>>(tableName: TableName): SelectQB<Schema, TableName, InitialState<Schema, TableName>["output"], TableName>;
};
export {};
//# sourceMappingURL=query-builder.d.ts.map