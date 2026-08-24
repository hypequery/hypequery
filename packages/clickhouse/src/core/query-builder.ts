import type { DatabaseAdapter, QueryExecutionOptions } from './adapters/database-adapter.js';
import { createClickHouseAdapter } from './adapters/clickhouse-adapter.js';
import { ClickHouseDialect } from './dialects/clickhouse-dialect.js';
import type { SqlDialect } from './dialects/sql-dialect.js';
import { CrossFilter } from './cross-filter.js';
import {
  FilterOperator,
  OperatorValueMap,
  OrderDirection,
  JoinType,
  type JoinConditionInput,
  type SelectQueryNode,
  type SourceNode,
} from '../types/index.js';
import { AnySchema, ColumnType } from '../types/schema.js';
import { AggregationFeature } from './features/aggregations.js';
import { JoinFeature } from './features/joins.js';
import { FilteringFeature } from './features/filtering.js';
import { AnalyticsFeature } from './features/analytics.js';
import { ExecutorFeature } from './features/executor.js';
import { QueryModifiersFeature } from './features/query-modifiers.js';
import { FilterValidator } from './validators/filter-validator.js';
import { JoinRelationships, JoinPathOptions, type JoinPath, type ValidJoinPathChain } from './join-relationships.js';
import { SqlExpression } from './utils/sql-expressions.js';
import {
  PredicateBuilder,
  PredicateExpression,
  createPredicateBuilder,
} from './utils/predicate-builder.js';
import { CrossFilteringFeature } from './features/cross-filtering.js';
import {
  cloneSelectQueryNode,
  createSelectQueryNode,
  type QueryNodeTransform,
  transformSelectQueryNode,
} from './query-node.js';
import type { ClickHouseSettings, BaseClickHouseClientConfigOptions } from '@clickhouse/client-common';
import type { ClickHouseClient as NodeClickHouseClient } from '@clickhouse/client';
import type { ClickHouseClient as WebClickHouseClient } from '@clickhouse/client-web';
import type { CacheOptions, CacheConfig } from './cache/types.js';
import type { QueryRuntimeContext } from './cache/runtime-context.js';
import { executeWithCache } from './cache/cache-manager.js';
import { mergeCacheOptionsPartial, initializeCacheRuntime } from './cache/utils.js';
import { InsertBuilder, type InsertQB } from './insert-builder.js';
import { SUBQUERY_SOURCE_TABLE, type InitialInsertState } from './types/builder-state.js';
import { normalizeFilterApplication } from './utils/filter-application.js';
import { assertSafeIdentifier } from './utils/insert-identifiers.js';
import { toLegacyQueryConfig } from './utils/query-config-compat.js';
import { applyRelationPath, resolveRelationPath } from './utils/relation-application.js';
import type {
  BuilderState,
  AnyBuilderState,
  SchemaDefinition,
  InitialState,
  UpdateOutput,
  WidenTables,
  AppendToOutput,
  BaseRow,
  AddAlias,
  AddScalar,
  FromSubqueryState,
} from './types/builder-state.js';
import {
  SelectableItem,
  SelectableColumn,
  ArraySelectableColumn,
  SelectionResult,
  ColumnSelectionValue
} from './types/select-types.js';

type WhereColumn<State extends AnyBuilderState> = SelectableColumn<State>;

type ColumnOperatorValue<
  Schema extends SchemaDefinition<Schema>,
  State extends BuilderState<Schema, string, any, keyof Schema, Partial<Record<string, keyof Schema>>, any, any>,
  Column extends WhereColumn<State>,
  Op extends keyof OperatorValueMap<any, Schema>
> = OperatorValueMap<ColumnSelectionValue<State, Column>, Schema>[Op];

type TableSourceMethodThis<State extends AnyBuilderState, Builder> =
  Extract<State['tables'], typeof SUBQUERY_SOURCE_TABLE> extends never ? Builder : never;

// Union type that accepts either client type
type ClickHouseClient = NodeClickHouseClient | WebClickHouseClient;
type ScalarAlias<Alias extends string> = Alias extends `${string} ${string}` ? never : Alias;
type JoinPathTableName<
  Schema extends SchemaDefinition<Schema>,
  Path extends JoinPath<Schema, string>
> = Extract<Path['to'], keyof Schema>;
type JoinPathAlias<Path extends JoinPath<any, string>, OverrideAlias extends string | undefined> =
  OverrideAlias extends string
  ? OverrideAlias
  : Path['alias'] extends string
  ? Path['alias']
  : undefined;
type ApplyJoinPathState<
  Schema extends SchemaDefinition<Schema>,
  State extends AnyBuilderState,
  Path extends JoinPath<Schema, string>,
  OverrideAlias extends string | undefined = undefined
> = JoinPathAlias<Path, OverrideAlias> extends string
  ? AddAlias<
    WidenTables<State, JoinPathTableName<Schema, Path>>,
    JoinPathAlias<Path, OverrideAlias>,
    JoinPathTableName<Schema, Path>
  >
  : WidenTables<State, JoinPathTableName<Schema, Path>>;
type ApplyJoinPathChainState<
  Schema extends SchemaDefinition<Schema>,
  State extends AnyBuilderState,
  Paths extends readonly JoinPath<Schema, string>[]
> = Paths extends readonly [infer First, ...infer Rest]
  ? First extends JoinPath<Schema, string>
  ? Rest extends readonly JoinPath<Schema, string>[]
  ? ApplyJoinPathChainState<Schema, ApplyJoinPathState<Schema, State, First>, Rest>
  : ApplyJoinPathState<Schema, State, First>
  : State
  : State;
const ADVANCED_IN_OPERATORS = new Set<FilterOperator>([
  'globalIn',
  'globalNotIn',
  'inSubquery',
  'globalInSubquery',
  'inTable',
  'globalInTable',
  'inTuple',
  'globalInTuple',
]);

export interface ExecuteOptions {
  queryId?: string;
  cache?: CacheOptions | false;
}

export interface ClickHouseConnectionOptions extends Omit<BaseClickHouseClientConfigOptions, 'host'> {
  /**
   * @deprecated Use `url` instead. `host` is kept for backward compatibility.
   */
  host?: BaseClickHouseClientConfigOptions['host'];
}

/**
 * Configuration for client-based connections.
 */
export interface ClickHouseClientConfig extends ClickHouseConnectionOptions {
  /** Pre-configured ClickHouse client instance. */
  client: ClickHouseClient;
}

/**
 * Configuration options for ClickHouse connections.
 * Either provide a client instance OR connection details, but not both.
 */
export type ClickHouseConfig = ClickHouseConnectionOptions | ClickHouseClientConfig;

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
  State extends BuilderState<Schema, string, any, keyof Schema, Partial<Record<string, keyof Schema>>, any, any>
> {
  private static relationships: JoinRelationships<any>;

  private query: SelectQueryNode<State['output'], Schema>;
  private tableName: string;
  private state: State;
  private aggregations: AggregationFeature<Schema, State>;
  private joins: JoinFeature<Schema, State>;
  private filtering: FilteringFeature<Schema, State>;
  private analytics: AnalyticsFeature<Schema, State>;
  private executor: ExecutorFeature<Schema, State>;
  private modifiers: QueryModifiersFeature<Schema, State>;
  private crossFiltering: CrossFilteringFeature<Schema, State>;
  private runtime: QueryRuntimeContext;
  private adapter: DatabaseAdapter;
  private dialect: SqlDialect;
  private cacheOptions?: CacheOptions;
  private queryTransforms: Array<QueryNodeTransform<State['output'], Schema>> = [];

  constructor(
    tableName: string,
    state: State,
    runtime: QueryRuntimeContext,
    adapter: DatabaseAdapter,
    dialect: SqlDialect,
    source?: SourceNode,
  ) {
    this.tableName = tableName;
    this.query = createSelectQueryNode({
      from: source ?? {
        kind: 'table',
        name: tableName,
      },
    });
    this.state = state;
    this.runtime = runtime;
    this.adapter = adapter;
    this.dialect = dialect;
    this.aggregations = new AggregationFeature(this);
    this.joins = new JoinFeature(this);
    this.filtering = new FilteringFeature(this);
    this.analytics = new AnalyticsFeature(this);
    this.executor = new ExecutorFeature(this);
    this.modifiers = new QueryModifiersFeature(this);
    this.crossFiltering = new CrossFilteringFeature(this);
  }

  private fork<
    NextState extends BuilderState<
      Schema,
      string,
      any,
      State['baseTable'],
      Partial<Record<string, keyof Schema>>,
      any,
      State['base']
    >
  >(
    state: NextState,
    query: SelectQueryNode<NextState['output'], Schema>
  ): QueryBuilder<Schema, NextState> {
    return this.transition(state, query);
  }

  private transition<
    NextState extends BuilderState<
      Schema,
      string,
      any,
      State['baseTable'],
      Partial<Record<string, keyof Schema>>,
      any,
      State['base']
    >
  >(
    state: NextState,
    query: SelectQueryNode<NextState['output'], Schema>
  ): QueryBuilder<Schema, NextState> {
    const builder = new QueryBuilder<Schema, NextState>(this.tableName, state, this.runtime, this.adapter, this.dialect);
    builder.query = cloneSelectQueryNode(query);
    builder.cacheOptions = this.cacheOptions ? { ...this.cacheOptions } : undefined;
    builder.queryTransforms = [...this.queryTransforms] as Array<QueryNodeTransform<NextState['output'], Schema>>;
    return builder;
  }

  private cloneMutable(): this {
    return this.fork(this.state, this.query) as this;
  }

  private assignQuery(
    builder: this,
    query: SelectQueryNode<State['output'], Schema>
  ): this {
    builder.query = cloneSelectQueryNode(query);
    return builder;
  }

  private updateQuery(
    updater: (
      query: SelectQueryNode<State['output'], Schema>
    ) => SelectQueryNode<State['output'], Schema>
  ): this {
    return this.assignQuery(this.cloneMutable(), updater(this.query));
  }

  private assertTableSource(feature: 'FINAL' | 'PREWHERE', innerMethod: 'final()' | 'prewhere()'): void {
    if (this.query.from?.kind === 'subquery') {
      throw new Error(
        `${feature} can only be applied to a table source. Apply ${innerMethod} to the inner query before passing it to db.from().`
      );
    }
  }

  private withAliasesState<
    NextState extends BuilderState<
      Schema,
      string,
      any,
      State['baseTable'],
      Partial<Record<string, keyof Schema>>,
      any,
      State['base']
    >
  >(aliases: NextState['aliases']): NextState {
    return {
      ...this.state,
      aliases,
    } as unknown as NextState;
  }

  private buildSelectState<NextOutput>(output: NextOutput): UpdateOutput<State, NextOutput> {
    return {
      ...this.state,
      output,
    } as UpdateOutput<State, NextOutput>;
  }

  private buildSelectQuery<NextOutput>(selections: string[]): SelectQueryNode<NextOutput, Schema> {
    return {
      ...this.query,
      select: selections.map(selection => ({ kind: 'selection' as const, selection })),
      orderBy: this.query.orderBy?.map(({ column, direction }) => ({
        kind: 'order-by-item' as const,
        column: String(column),
        direction,
      })),
    };
  }

  private createDetachedBuilder(): this {
    const builder = new QueryBuilder<Schema, State>(
      this.tableName,
      this.state,
      this.runtime,
      this.adapter,
      this.dialect
    ) as this;
    builder.query = createSelectQueryNode();
    builder.cacheOptions = this.cacheOptions ? { ...this.cacheOptions } : undefined;
    builder.queryTransforms = [...this.queryTransforms];
    return builder;
  }

  private runDraftCallback(seed: this, callback: (builder: this) => void): this {
    let current: QueryBuilder<Schema, State> = seed;

    // Group callbacks expect fluent chaining, so the draft keeps rebinding
    // method calls to the latest immutable builder instance produced so far.
    const draft = new Proxy(seed as object, {
      get: (_target, prop, receiver) => {
        const value = Reflect.get(current as object, prop, receiver);
        if (typeof value !== 'function') {
          return value;
        }

        return (...args: unknown[]) => {
          const result = value.apply(current, args);
          if (result instanceof QueryBuilder) {
            current = result;
            return draft;
          }
          return result;
        };
      },
    });

    callback(draft as this);
    return current as this;
  }

  debug() {
    console.log('Current Type:', {
      state: this.state,
      query: this.query
    });
    return this;
  }

  cache(options: CacheOptions | false): this {
    const next = this.cloneMutable();
    if (options === false) {
      next.cacheOptions = { mode: 'no-store', ttlMs: 0, staleTtlMs: 0, cacheTimeMs: 0 };
      return next;
    }
    next.cacheOptions = mergeCacheOptionsPartial(next.cacheOptions, options);
    return next;
  }

  // --- Analytics Helper: Add a CTE.
  withCTE(
    alias: string,
    subquery: QueryBuilder<any, AnyBuilderState> | string
  ): this {
    assertSafeIdentifier(alias, 'CTE alias');
    return this.updateQuery(() => this.analytics.addCTE(alias, subquery));
  }

  // --- Analytics Helper: Add a scalar WITH alias.
  withScalar<Alias extends string, TValue>(
    alias: ScalarAlias<Alias>,
    expressionBuilder: (expr: PredicateBuilder<State>) => PredicateExpression<TValue>
  ): QueryBuilder<Schema, AddScalar<State, Alias, TValue>> {
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(alias)) {
      throw new Error(
        `Invalid scalar alias "${alias}". Use an unquoted SQL identifier (letters, numbers, underscore; cannot start with a number).`
      );
    }
    const expression = expressionBuilder(createPredicateBuilder<State>());
    const nextConfig = this.analytics.addScalar(alias, expression);
    const nextScalars = {
      ...this.state.scalars,
      [alias]: undefined as TValue,
    } as AddScalar<State, Alias, TValue>['scalars'];
    const nextState: AddScalar<State, Alias, TValue> = {
      ...this.state,
      scalars: nextScalars,
    };

    return this.transition<AddScalar<State, Alias, TValue>>(nextState, nextConfig);
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
    return this.updateQuery(() => this.analytics.addTimeInterval(
      String(column),
      interval,
      method,
      this.dialect,
    ));
  }

  // --- Analytics Helper: Add a raw SQL fragment.
  raw(sql: string): this {
    return this.updateQuery(query => ({
      ...query,
      having: [...(query.having || []), { kind: 'having' as const, expression: sql }],
    }));
  }

  // --- Analytics Helper: Add query settings.
  settings(opts: ClickHouseSettings): this {
    return this.updateQuery(() => this.analytics.addSettings(opts));
  }

  final(): this {
    this.assertTableSource('FINAL', 'final()');

    return this.updateQuery(query => ({
      ...query,
      from: {
        kind: 'table',
        name: query.from?.kind === 'table' ? query.from.name : this.tableName,
        final: true,
      },
    }));
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
    return this.crossFiltering.applyCrossFilters(
      crossFilter as unknown as CrossFilter<Schema, Extract<keyof Schema, string>>
    ) as this;
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
      type NextOutput = BaseRow<State>;
      return this.fork(
        this.buildSelectState<NextOutput>({} as NextOutput),
        this.buildSelectQuery<NextOutput>(['*']),
      );
    }

    const columns = columnsOrAsterisk as Selections;

    const processedColumns = columns.map(col => {
      if (typeof col === 'object' && col !== null && '__type' in col) {
        return (col as SqlExpression).toSql();
      }
      return String(col);
    });

    type NextOutput = SelectionResult<State, Selections[number]>;
    return this.fork(
      this.buildSelectState<NextOutput>({} as NextOutput),
      this.buildSelectQuery<NextOutput>(processedColumns),
    );
  }

  selectConst<Selections extends ReadonlyArray<SelectableItem<State>>>(
    ...columns: Selections
  ): QueryBuilder<Schema, UpdateOutput<State, SelectionResult<State, Selections[number]>>> {
    return this.select(columns);
  }

  sum<Column extends SelectableColumn<State>, Alias extends string = `${Column & string}_sum`>(
    column: Column,
    alias?: Alias
  ): QueryBuilder<Schema, AppendToOutput<State, Record<Alias, string>>> {
    return this.applyAggregation(column, alias, 'sum', (col, finalAlias) =>
      this.aggregations.sum(col, finalAlias)
    );
  }

  count<Column extends SelectableColumn<State>, Alias extends string = `${Column & string}_count`>(
    column: Column,
    alias?: Alias
  ): QueryBuilder<Schema, AppendToOutput<State, Record<Alias, string>>> {
    return this.applyAggregation(column, alias, 'count', (col, finalAlias) =>
      this.aggregations.count(col, finalAlias)
    );
  }

  avg<Column extends SelectableColumn<State>, Alias extends string = `${Column & string}_avg`>(
    column: Column,
    alias?: Alias
  ): QueryBuilder<Schema, AppendToOutput<State, Record<Alias, string>>> {
    return this.applyAggregation(column, alias, 'avg', (col, finalAlias) =>
      this.aggregations.avg(col, finalAlias)
    );
  }

  min<Column extends SelectableColumn<State>, Alias extends string = `${Column & string}_min`>(
    column: Column,
    alias?: Alias
  ): QueryBuilder<Schema, AppendToOutput<State, Record<Alias, string>>> {
    return this.applyAggregation(column, alias, 'min', (col, finalAlias) =>
      this.aggregations.min(col, finalAlias)
    );
  }

  max<Column extends SelectableColumn<State>, Alias extends string = `${Column & string}_max`>(
    column: Column,
    alias?: Alias
  ): QueryBuilder<Schema, AppendToOutput<State, Record<Alias, string>>> {
    return this.applyAggregation(column, alias, 'max', (col, finalAlias) =>
      this.aggregations.max(col, finalAlias)
    );
  }

  countDistinct<Column extends keyof BaseRow<State>, Alias extends string = `${Column & string}_countDistinct`>(
    column: Column,
    alias?: Alias
  ): QueryBuilder<Schema, AppendToOutput<State, Record<Alias, string>>> {
    return this.applyAggregation(column, alias, 'countDistinct', (col, finalAlias) =>
      this.aggregations.countDistinct(col, finalAlias)
    );
  }

  /** Value of `column` on the row where `argColumn` is greatest (ClickHouse `argMax`). */
  argMax<Column extends SelectableColumn<State>, Alias extends string = `${Column & string}_argMax`>(
    column: Column,
    argColumn: SelectableColumn<State>,
    alias?: Alias
  ): QueryBuilder<Schema, AppendToOutput<State, Record<Alias, string>>> {
    return this.applyAggregation(column, alias, 'argMax', (col, finalAlias) =>
      this.aggregations.argMax(col, String(argColumn), finalAlias)
    );
  }

  /** Value of `column` on the row where `argColumn` is smallest (ClickHouse `argMin`). */
  argMin<Column extends SelectableColumn<State>, Alias extends string = `${Column & string}_argMin`>(
    column: Column,
    argColumn: SelectableColumn<State>,
    alias?: Alias
  ): QueryBuilder<Schema, AppendToOutput<State, Record<Alias, string>>> {
    return this.applyAggregation(column, alias, 'argMin', (col, finalAlias) =>
      this.aggregations.argMin(col, String(argColumn), finalAlias)
    );
  }

  /** Approximate percentile of `column` at `level` in [0, 1] (ClickHouse `quantile(level)`). */
  quantile<Column extends SelectableColumn<State>, Alias extends string = `${Column & string}_quantile`>(
    column: Column,
    level: number,
    alias?: Alias
  ): QueryBuilder<Schema, AppendToOutput<State, Record<Alias, string>>> {
    return this.applyAggregation(column, alias, 'quantile', (col, finalAlias) =>
      this.aggregations.quantile(col, level, finalAlias)
    );
  }

  /** Sample standard deviation of `column` (ClickHouse `stddevSamp`). */
  stddev<Column extends SelectableColumn<State>, Alias extends string = `${Column & string}_stddev`>(
    column: Column,
    alias?: Alias
  ): QueryBuilder<Schema, AppendToOutput<State, Record<Alias, string>>> {
    return this.applyAggregation(column, alias, 'stddev', (col, finalAlias) =>
      this.aggregations.stddev(col, finalAlias)
    );
  }

  /** Sample variance of `column` (ClickHouse `varSamp`). */
  variance<Column extends SelectableColumn<State>, Alias extends string = `${Column & string}_variance`>(
    column: Column,
    alias?: Alias
  ): QueryBuilder<Schema, AppendToOutput<State, Record<Alias, string>>> {
    return this.applyAggregation(column, alias, 'variance', (col, finalAlias) =>
      this.aggregations.variance(col, finalAlias)
    );
  }

  private applyAggregation<Column extends keyof BaseRow<State>, Alias extends string>(
    column: Column,
    alias: Alias | undefined,
    suffix: string,
    updater: (column: string, alias: Alias) => SelectQueryNode<AppendToOutput<State, Record<Alias, string>>['output'], Schema>
  ): QueryBuilder<Schema, AppendToOutput<State, Record<Alias, string>>> {
    const columnName = String(column);
    const finalAlias = (alias || `${columnName}_${suffix}`) as Alias;

    type NextState = AppendToOutput<State, Record<Alias, string>>;
    const nextState = this.buildSelectState<NextState['output']>({} as NextState['output']) as NextState;

    const nextConfig = updater(columnName, finalAlias);
    return this.fork(nextState, nextConfig);
  }

  // Make needed properties accessible to features
  getTableName() {
    return this.tableName;
  }

  getBaseTable(): State['baseTable'] {
    return this.state.baseTable;
  }

  getRuntimeContext() {
    return this.runtime;
  }

  getAdapter(): DatabaseAdapter {
    return this.adapter;
  }

  getDialect(): SqlDialect {
    return this.dialect;
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
    if (ADVANCED_IN_OPERATORS.has(operator) || operator === 'isNull' || operator === 'isNotNull') {
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

  private applyFilter(
    clause: 'where' | 'prewhere',
    conjunction: 'AND' | 'OR',
    columnOrColumns: WhereColumn<State> | WhereColumn<State>[] | ((expr: PredicateBuilder<State>) => PredicateExpression),
    operator?: FilterOperator,
    value?: any
  ): this {
    if (clause === 'prewhere') {
      this.assertTableSource('PREWHERE', 'prewhere()');
    }

    const normalized = normalizeFilterApplication(
      clause,
      conjunction,
      columnOrColumns as string | string[] | ((expr: PredicateBuilder<any>) => PredicateExpression),
      operator,
      value,
      builder => builder(createPredicateBuilder<State>())
    );

    if (normalized.kind === 'expression') {
      return this.updateQuery(() => this.filtering.addExpressionCondition(clause, conjunction, normalized.expression));
    }

    this.validateFilterValue(normalized.validationTarget as WhereColumn<State> | WhereColumn<State>[], normalized.operator, normalized.value);
    return this.updateQuery(() => this.filtering.addCondition(
      clause,
      conjunction,
      normalized.column,
      normalized.operator,
      normalized.value
    ));
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
    return this.applyFilter('where', 'AND', columnOrColumns, operator as FilterOperator | undefined, value);
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
    return this.applyFilter('where', 'OR', columnOrColumns, operator, value);
  }

  prewhere(
    this: TableSourceMethodThis<State, this>,
    expressionBuilder: (expr: PredicateBuilder<State>) => PredicateExpression
  ): this;
  prewhere<Column extends WhereColumn<State>, Op extends keyof OperatorValueMap<any, Schema>>(
    this: TableSourceMethodThis<State, this>,
    columnOrColumns: Column | Column[],
    operator: Op,
    value: ColumnOperatorValue<Schema, State, Column, Op>
  ): this;
  prewhere<Column extends WhereColumn<State>>(
    this: TableSourceMethodThis<State, this>,
    columns: Column[],
    operator: 'inTuple' | 'globalInTuple',
    value: any
  ): this;
  prewhere<Column extends WhereColumn<State>, Op extends keyof OperatorValueMap<any, Schema>>(
    columnOrColumns: Column | Column[] | ((expr: PredicateBuilder<State>) => PredicateExpression),
    operator?: Op,
    value?: any
  ): this {
    return this.applyFilter('prewhere', 'AND', columnOrColumns, operator as FilterOperator | undefined, value);
  }

  orPrewhere(
    this: TableSourceMethodThis<State, this>,
    expressionBuilder: (expr: PredicateBuilder<State>) => PredicateExpression
  ): this;
  orPrewhere<Column extends WhereColumn<State>>(
    this: TableSourceMethodThis<State, this>,
    column: Column,
    operator: FilterOperator,
    value: any
  ): this;
  orPrewhere<Column extends WhereColumn<State>>(
    this: TableSourceMethodThis<State, this>,
    columns: Column[],
    operator: 'inTuple' | 'globalInTuple',
    value: any
  ): this;
  orPrewhere<Column extends WhereColumn<State>>(
    columnOrColumns: Column | Column[] | ((expr: PredicateBuilder<State>) => PredicateExpression),
    operator?: FilterOperator,
    value?: any
  ): this {
    return this.applyFilter('prewhere', 'OR', columnOrColumns, operator, value);
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
    const groupBuilder = this.runDraftCallback(this.createDetachedBuilder(), callback);
    return this.updateQuery(() => this.filtering.addGroup('where', 'AND', groupBuilder.getQueryNode().where));
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
    const groupBuilder = this.runDraftCallback(this.createDetachedBuilder(), callback);
    return this.updateQuery(() => this.filtering.addGroup('where', 'OR', groupBuilder.getQueryNode().where));
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
    return this.updateQuery(() => this.modifiers.addGroupBy(normalized));
  }

  arrayJoin(column: ArraySelectableColumn<State>): this {
    return this.updateQuery(() => this.modifiers.addArrayJoin('ARRAY', String(column)));
  }

  leftArrayJoin(column: ArraySelectableColumn<State>): this {
    return this.updateQuery(() => this.modifiers.addArrayJoin('LEFT ARRAY', String(column)));
  }

  limit(count: number): this {
    return this.updateQuery(() => this.modifiers.addLimit(count));
  }

  limitBy(
    count: number,
    by: SelectableColumn<State> | Array<SelectableColumn<State>>
  ): this {
    const normalized = Array.isArray(by) ? by.map(String) : String(by);
    return this.updateQuery(() => this.modifiers.addLimitBy(count, normalized));
  }

  offset(count: number): this {
    return this.updateQuery(() => this.modifiers.addOffset(count));
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
    return this.updateQuery(() => this.modifiers.addOrderBy(String(column), direction));
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
    return this.updateQuery(() => this.modifiers.addHaving(condition, parameters));
  }

  distinct(): this {
    return this.updateQuery(() => this.modifiers.setDistinct());
  }

  withTotals(): this {
    return this.updateQuery(() => this.modifiers.setWithTotals());
  }

  whereNull<Column extends WhereColumn<State>>(column: Column): this {
    return this.updateQuery(() => this.filtering.addCondition('where', 'AND', String(column), 'isNull', null));
  }

  whereNotNull<Column extends WhereColumn<State>>(column: Column): this {
    return this.updateQuery(() => this.filtering.addCondition('where', 'AND', String(column), 'isNotNull', null));
  }

  orWhereNull<Column extends WhereColumn<State>>(column: Column): this {
    return this.updateQuery(() => this.filtering.addCondition('where', 'OR', String(column), 'isNull', null));
  }

  orWhereNotNull<Column extends WhereColumn<State>>(column: Column): this {
    return this.updateQuery(() => this.filtering.addCondition('where', 'OR', String(column), 'isNotNull', null));
  }

  prewhereNull<Column extends WhereColumn<State>>(
    this: TableSourceMethodThis<State, this>,
    column: Column
  ): this;
  prewhereNull<Column extends WhereColumn<State>>(column: Column): this {
    this.assertTableSource('PREWHERE', 'prewhere()');
    return this.updateQuery(() => this.filtering.addCondition('prewhere', 'AND', String(column), 'isNull', null));
  }

  prewhereNotNull<Column extends WhereColumn<State>>(
    this: TableSourceMethodThis<State, this>,
    column: Column
  ): this;
  prewhereNotNull<Column extends WhereColumn<State>>(column: Column): this {
    this.assertTableSource('PREWHERE', 'prewhere()');
    return this.updateQuery(() => this.filtering.addCondition('prewhere', 'AND', String(column), 'isNotNull', null));
  }

  whereBetween<Column extends keyof BaseRow<State>>(
    column: Column,
    [min, max]: [BaseRow<State>[Column], BaseRow<State>[Column]]
  ): this {
    if (min === null || max === null) {
      throw new Error('BETWEEN values cannot be null');
    }
    return this.where(
      column,
      'between',
      [min, max] as ColumnOperatorValue<Schema, State, Column, 'between'>
    );
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
    alias?: Alias,
    on?: JoinConditionInput | JoinConditionInput[],
  ): QueryBuilder<
    Schema,
    Alias extends string
    ? AddAlias<WidenTables<State, TableName>, Alias, TableName>
    : WidenTables<State, TableName>
  > {
    return this.applyJoin('LEFT', table, leftColumn, rightColumn, alias, on);
  }

  /**
   * ClickHouse `LEFT ANY JOIN`: like `leftJoin`, but takes at most one matching
   * right-side row per left row, so duplicate join keys never fan out the
   * result. Used by the semantic layer for to-one relationship traversal.
   */
  leftAnyJoin<TableName extends Extract<keyof Schema, string>, Alias extends string | undefined = undefined>(
    table: TableName,
    leftColumn: keyof BaseRow<State>,
    rightColumn: `${TableName & string}.${keyof Schema[TableName] & string}`,
    alias?: Alias,
    on?: JoinConditionInput | JoinConditionInput[],
  ): QueryBuilder<
    Schema,
    Alias extends string
    ? AddAlias<WidenTables<State, TableName>, Alias, TableName>
    : WidenTables<State, TableName>
  > {
    return this.applyJoin('LEFT ANY', table, leftColumn, rightColumn, alias, on);
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
    alias?: Alias,
    on?: JoinConditionInput | JoinConditionInput[],
  ): QueryBuilder<
    Schema,
    Alias extends string
    ? AddAlias<WidenTables<State, TableName>, Alias, TableName>
    : WidenTables<State, TableName>
  > {
    type JoinedState = WidenTables<State, TableName>;
    type NextState = Alias extends string ? AddAlias<JoinedState, Alias, TableName> : JoinedState;

    const nextAliases = (
      alias
        ? { ...this.state.aliases, [alias]: table }
        : this.state.aliases
    ) as NextState['aliases'];

    const nextState = this.withAliasesState<NextState>(nextAliases);

    const nextConfig = this.joins.addJoin(type, table, String(leftColumn), rightColumn, alias, undefined, on);
    return this.transition<NextState>(nextState, nextConfig);
  }

  /**
   * @deprecated Prefer `getQueryNode()` for inspection or `toQueryNode()` for the
   * transformed query tree used during compilation.
   */
  getConfig() {
    return toLegacyQueryConfig(this.getQueryNode());
  }

  toQueryNode(): SelectQueryNode<State['output'], Schema> {
    return transformSelectQueryNode(
      this.query,
      this.queryTransforms as ReadonlyArray<QueryNodeTransform<State['output'], Schema>>,
    );
  }

  getQueryNode(): SelectQueryNode<State['output'], Schema> {
    return cloneSelectQueryNode(this.query);
  }

  static setJoinRelationships<S extends SchemaDefinition<S>>(
    relationships: JoinRelationships<S>
  ): void {
    this.relationships = relationships;
  }

  /**
   * Apply a predefined join relationship
   */
  withRelation<
    Path extends JoinPath<Schema, State['tables']>,
    Alias extends string | undefined = undefined
  >(
    path: Path,
    options?: Omit<JoinPathOptions, 'alias'> & { alias?: Alias }
  ): QueryBuilder<Schema, ApplyJoinPathState<Schema, State, Path, Alias>>;
  withRelation<
    Paths extends readonly [
      JoinPath<Schema, State['tables']>,
      ...JoinPath<Schema, string>[],
    ]
  >(
    paths: Paths & ValidJoinPathChain<Schema, State['tables'], Paths>,
    options?: Omit<JoinPathOptions, 'alias'>
  ): QueryBuilder<Schema, ApplyJoinPathChainState<Schema, State, Paths>>;
  withRelation(name: string, options?: JoinPathOptions): this;
  withRelation(
    nameOrPath: string | JoinPath<Schema> | readonly JoinPath<Schema>[],
    options?: JoinPathOptions
  ): QueryBuilder<Schema, any> {
    const next = this.cloneMutable();
    const { path, label } = resolveRelationPath(nameOrPath, QueryBuilder.relationships as JoinRelationships<Schema> | undefined);
    next.query = applyRelationPath(
      next.query,
      path,
      options,
      (currentQuery, joinPath, relationOptions) => {
        next.query = currentQuery;
        const type = options?.type || joinPath.type || 'INNER';
        const alias = relationOptions?.alias || joinPath.alias;
        const leftColumn = String(joinPath.leftColumn);
        const leftSource = String(joinPath.from);
        const table = String(joinPath.to) as Extract<keyof Schema, string>;
        const rightColumn = `${table}.${joinPath.rightColumn}` as `${typeof table}.${keyof Schema[typeof table] & string}`;
        return next.joins.addJoin(type, table, leftColumn, rightColumn, alias, leftSource);
      },
      label
    );
    return next;
  }
}

export type SelectQB<
  Schema extends SchemaDefinition<Schema>,
  Tables extends string,
  Output,
  BaseTable extends keyof Schema
> = QueryBuilder<Schema, BuilderState<Schema, Tables, Output, BaseTable, {}>>;

export type CreateQueryBuilderConfig =
  | (ClickHouseConfig & {
    cache?: CacheConfig;
    adapter?: DatabaseAdapter;
    dialect?: SqlDialect;
  })
  | {
    adapter: DatabaseAdapter;
    cache?: CacheConfig;
    dialect?: SqlDialect;
  };

export function createQueryBuilder<Schema extends SchemaDefinition<Schema>>(
  config: CreateQueryBuilderConfig
) {
  const { cache: cacheConfig, adapter, dialect } = config as {
    cache?: CacheConfig;
    adapter?: DatabaseAdapter;
    dialect?: SqlDialect;
  };
  const resolvedAdapter = adapter ?? createClickHouseAdapter(config as ClickHouseConfig);
  const resolvedDialect = dialect ?? new ClickHouseDialect();
  const namespace = cacheConfig?.namespace || resolvedAdapter.namespace || resolvedAdapter.name;
  const { runtime, cacheController } = initializeCacheRuntime(cacheConfig, namespace);

  return {
    cache: cacheController,
    adapter: resolvedAdapter,
    dialect: resolvedDialect,
    async rawQuery<TResult = any>(
      sql: string,
      params: unknown[] = [],
      options?: QueryExecutionOptions
    ) {
      return resolvedAdapter.query<TResult>(sql, params, options);
    },
    /**
     * Closes the underlying connection pool for graceful shutdown. A client
     * passed in through config is closed too, and the builder must not be used
     * afterwards.
     */
    async close(): Promise<void> {
      await resolvedAdapter.close?.();
    },
    /**
     * Starts a type-safe insert into the given table.
     *
     * Row shapes are derived from the schema: `Nullable(...)` columns are
     * optional, every other column is required.
     *
     * @example
     * ```ts
     * await db.insert('events')
     *   .values([{ id: 1, name: 'signup', created_at: new Date() }])
     *   .execute();
     * ```
     */
    insert<TableName extends Extract<keyof Schema, string>>(
      tableName: TableName
    ): InsertQB<Schema, TableName> {
      const state = {
        schema: {} as Schema,
        table: tableName,
        row: {} as InitialInsertState<Schema, TableName>['row'],
      } as InitialInsertState<Schema, TableName>;

      return new InsertBuilder<Schema, InitialInsertState<Schema, TableName>>(
        tableName,
        state,
        resolvedAdapter,
      );
    },
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
        aliases: {} as Partial<Record<string, keyof Schema>>,
        scalars: {} as InitialState<Schema, TableName>['scalars']
      } as InitialState<Schema, TableName>;

      return new QueryBuilder<Schema, typeof state>(
        tableName as string,
        state,
        runtime,
        resolvedAdapter,
        resolvedDialect,
      );
    },
    /**
     * Starts a type-safe query whose source is another select query.
     * Only columns produced by the subquery are visible to the outer query.
     *
     * @example
     * ```ts
     * const totals = db.table('orders')
     *   .select(['customer_id'])
     *   .sum('amount', 'total_amount')
     *   .groupBy('customer_id');
     *
     * const query = db.from(totals)
     *   .select(['customer_id', 'total_amount']);
     * ```
     */
    from<SubqueryState extends BuilderState<Schema, string, any, keyof Schema, any, any, any>>(
      subquery: QueryBuilder<Schema, SubqueryState>
    ): QueryBuilder<Schema, FromSubqueryState<Schema, SubqueryState>> {
      type NextState = FromSubqueryState<Schema, SubqueryState>;
      const subqueryNode = subquery.toQueryNode();
      const state: NextState = {
        schema: {} as Schema,
        tables: SUBQUERY_SOURCE_TABLE,
        output: {} as SubqueryState['output'],
        baseTable: subquery.getBaseTable(),
        base: {} as SubqueryState['output'],
        aliases: {},
        scalars: {},
      };

      const builder = new QueryBuilder<Schema, NextState>(
        subquery.getTableName(),
        state,
        runtime,
        resolvedAdapter,
        resolvedDialect,
        {
          kind: 'subquery',
          query: subqueryNode,
        },
      );

      return subqueryNode.settings
        ? builder.settings(subqueryNode.settings)
        : builder;
    }
  };
}
