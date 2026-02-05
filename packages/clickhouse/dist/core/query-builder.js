import { ClickHouseConnection } from './connection.js';
import { SQLFormatter } from './formatters/sql-formatter.js';
import { AggregationFeature } from './features/aggregations.js';
import { JoinFeature } from './features/joins.js';
import { FilteringFeature } from './features/filtering.js';
import { AnalyticsFeature } from './features/analytics.js';
import { ExecutorFeature } from './features/executor.js';
import { QueryModifiersFeature } from './features/query-modifiers.js';
import { FilterValidator } from './validators/filter-validator.js';
import { createPredicateBuilder, } from './utils/predicate-builder.js';
import { CrossFilteringFeature } from './features/cross-filtering.js';
import { executeWithCache } from './cache/cache-manager.js';
import { substituteParameters } from './utils.js';
import { mergeCacheOptionsPartial, initializeCacheRuntime } from './cache/utils.js';
/**
 * Type guard to check if a config is a client-based configuration.
 */
export function isClientConfig(config) {
    return 'client' in config && config.client !== undefined;
}
/**
 * A type-safe query builder for ClickHouse databases.
 * The builder carries a single state object that encodes scope, output, and schema metadata.
 */
export class QueryBuilder {
    static relationships;
    config = {};
    tableName;
    state;
    formatter = new SQLFormatter();
    aggregations;
    joins;
    filtering;
    analytics;
    executor;
    modifiers;
    crossFiltering;
    runtime;
    cacheOptions;
    constructor(tableName, state, runtime) {
        this.tableName = tableName;
        this.state = state;
        this.runtime = runtime;
        this.aggregations = new AggregationFeature(this);
        this.joins = new JoinFeature(this);
        this.filtering = new FilteringFeature(this);
        this.analytics = new AnalyticsFeature(this);
        this.executor = new ExecutorFeature(this);
        this.modifiers = new QueryModifiersFeature(this);
        this.crossFiltering = new CrossFilteringFeature(this);
    }
    fork(state, config) {
        const builder = new QueryBuilder(this.tableName, state, this.runtime);
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
    cache(options) {
        if (options === false) {
            this.cacheOptions = { mode: 'no-store', ttlMs: 0, staleTtlMs: 0, cacheTimeMs: 0 };
            return this;
        }
        this.cacheOptions = mergeCacheOptionsPartial(this.cacheOptions, options);
        return this;
    }
    // --- Analytics Helper: Add a CTE.
    withCTE(alias, subquery) {
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
    groupByTimeInterval(column, interval, method = 'toStartOfInterval') {
        this.config = this.analytics.addTimeInterval(String(column), interval, method);
        return this;
    }
    // --- Analytics Helper: Add a raw SQL fragment.
    raw(sql) {
        // Use raw() to inject SQL that isn't supported by the builder.
        // Use with caution.
        this.config.having = this.config.having || [];
        this.config.having.push(sql);
        return this;
    }
    // --- Analytics Helper: Add query settings.
    settings(opts) {
        this.config = this.analytics.addSettings(opts);
        return this;
    }
    applyCrossFilters(crossFilter) {
        const normalized = crossFilter;
        this.config = this.crossFiltering.applyCrossFilters(normalized);
        return this;
    }
    select(columnsOrAsterisk) {
        if (columnsOrAsterisk === '*') {
            const nextState = {
                ...this.state,
                output: {}
            };
            const nextConfig = {
                ...this.config,
                select: ['*'],
                orderBy: this.config.orderBy?.map(({ column, direction }) => ({
                    column: String(column),
                    direction
                }))
            };
            return this.fork(nextState, nextConfig);
        }
        const columns = columnsOrAsterisk;
        const processedColumns = columns.map(col => {
            if (typeof col === 'object' && col !== null && '__type' in col) {
                return col.toSql();
            }
            return String(col);
        });
        const nextState = {
            ...this.state,
            output: {}
        };
        const nextConfig = {
            ...this.config,
            select: processedColumns,
            orderBy: this.config.orderBy?.map(({ column, direction }) => ({
                column: String(column),
                direction
            }))
        };
        return this.fork(nextState, nextConfig);
    }
    selectConst(...columns) {
        return this.select(columns);
    }
    sum(column, alias) {
        return this.applyAggregation(column, alias, 'sum', (col, finalAlias) => this.aggregations.sum(col, finalAlias));
    }
    count(column, alias) {
        return this.applyAggregation(column, alias, 'count', (col, finalAlias) => this.aggregations.count(col, finalAlias));
    }
    avg(column, alias) {
        return this.applyAggregation(column, alias, 'avg', (col, finalAlias) => this.aggregations.avg(col, finalAlias));
    }
    min(column, alias) {
        return this.applyAggregation(column, alias, 'min', (col, finalAlias) => this.aggregations.min(col, finalAlias));
    }
    max(column, alias) {
        return this.applyAggregation(column, alias, 'max', (col, finalAlias) => this.aggregations.max(col, finalAlias));
    }
    applyAggregation(column, alias, suffix, updater) {
        const columnName = String(column);
        const finalAlias = (alias || `${columnName}_${suffix}`);
        const nextState = {
            ...this.state,
            output: {}
        };
        const nextConfig = updater(columnName, finalAlias);
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
    toSQL() {
        return this.executor.toSQL();
    }
    toSQLWithParams() {
        return this.executor.toSQLWithParams();
    }
    execute(options) {
        return executeWithCache(this, options);
    }
    async stream() {
        return this.executor.stream();
    }
    /**
     * Processes each row in a stream with the provided callback function
     * @param callback Function to call for each row in the stream
     */
    async streamForEach(callback) {
        const stream = await this.stream();
        const reader = stream.getReader();
        try {
            while (true) {
                const { done, value: rows } = await reader.read();
                if (done)
                    break;
                for (const row of rows) {
                    await callback(row);
                }
            }
        }
        finally {
            reader.releaseLock();
        }
    }
    validateFilterValue(column, operator, value) {
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
        if (FilterValidator.validateJoinedColumn(columnName))
            return;
        const baseColumns = this.state.base;
        const columnType = baseColumns[columnName];
        FilterValidator.validateFilterCondition({ column: columnName, operator, value }, columnType);
    }
    where(columnOrColumns, operator, value) {
        if (typeof columnOrColumns === 'function') {
            const expression = columnOrColumns(createPredicateBuilder());
            this.config = this.filtering.addExpressionCondition('AND', expression);
            return this;
        }
        if (operator === undefined) {
            throw new Error('Operator is required when specifying a column for where()');
        }
        // Handle tuple operations
        if (Array.isArray(columnOrColumns) && (operator === 'inTuple' || operator === 'globalInTuple')) {
            const columns = columnOrColumns;
            this.validateFilterValue(columns, operator, value);
            this.config = this.filtering.addCondition('AND', columns.map(String), operator, value);
            return this;
        }
        const column = columnOrColumns;
        this.validateFilterValue(column, operator, value);
        this.config = this.filtering.addCondition('AND', String(column), operator, value);
        return this;
    }
    orWhere(columnOrColumns, operator, value) {
        if (typeof columnOrColumns === 'function') {
            const expression = columnOrColumns(createPredicateBuilder());
            this.config = this.filtering.addExpressionCondition('OR', expression);
            return this;
        }
        if (operator === undefined) {
            throw new Error('Operator is required when specifying a column for orWhere()');
        }
        if (Array.isArray(columnOrColumns) && (operator === 'inTuple' || operator === 'globalInTuple')) {
            const columns = columnOrColumns;
            this.validateFilterValue(columns, operator, value);
            this.config = this.filtering.addCondition('OR', columns.map(String), operator, value);
            return this;
        }
        const column = columnOrColumns;
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
    whereGroup(callback) {
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
    orWhereGroup(callback) {
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
    groupBy(columns) {
        const normalized = Array.isArray(columns) ? columns.map(String) : String(columns);
        this.config = this.modifiers.addGroupBy(normalized);
        return this;
    }
    limit(count) {
        this.config = this.modifiers.addLimit(count);
        return this;
    }
    offset(count) {
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
    orderBy(column, direction = 'ASC') {
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
    having(condition, parameters) {
        this.config = this.modifiers.addHaving(condition, parameters);
        return this;
    }
    distinct() {
        this.config = this.modifiers.setDistinct();
        return this;
    }
    whereBetween(column, [min, max]) {
        if (min === null || max === null) {
            throw new Error('BETWEEN values cannot be null');
        }
        return this.where(column, 'between', [min, max]);
    }
    innerJoin(table, leftColumn, rightColumn, alias) {
        return this.applyJoin('INNER', table, leftColumn, rightColumn, alias);
    }
    leftJoin(table, leftColumn, rightColumn, alias) {
        return this.applyJoin('LEFT', table, leftColumn, rightColumn, alias);
    }
    rightJoin(table, leftColumn, rightColumn, alias) {
        return this.applyJoin('RIGHT', table, leftColumn, rightColumn, alias);
    }
    fullJoin(table, leftColumn, rightColumn, alias) {
        return this.applyJoin('FULL', table, leftColumn, rightColumn, alias);
    }
    applyJoin(type, table, leftColumn, rightColumn, alias) {
        const nextState = {
            ...this.state,
            aliases: alias ? { ...this.state.aliases, [alias]: table } : this.state.aliases
        };
        const nextConfig = this.joins.addJoin(type, table, String(leftColumn), rightColumn, alias);
        return this.fork(nextState, nextConfig);
    }
    // Make config accessible to features
    getConfig() {
        return this.config;
    }
    static setJoinRelationships(relationships) {
        this.relationships = relationships;
    }
    /**
     * Apply a predefined join relationship
     */
    withRelation(name, options) {
        const relationships = QueryBuilder.relationships;
        if (!relationships) {
            throw new Error('Join relationships have not been initialized. Call QueryBuilder.setJoinRelationships first.');
        }
        const path = relationships.get(name);
        if (!path) {
            throw new Error(`Join relationship '${name}' not found`);
        }
        const applyJoin = (joinPath) => {
            const type = options?.type || joinPath.type || 'INNER';
            const alias = options?.alias || joinPath.alias;
            const table = String(joinPath.to);
            const rightColumn = `${table}.${joinPath.rightColumn}`;
            this.config = this.joins.addJoin(type, table, joinPath.leftColumn, rightColumn, alias);
        };
        if (Array.isArray(path)) {
            path.forEach(applyJoin);
        }
        else {
            applyJoin(path);
        }
        return this;
    }
}
function deriveNamespace(config) {
    if (isClientConfig(config)) {
        return 'client';
    }
    const host = 'host' in config ? config.host : 'unknown-host';
    const database = 'database' in config ? config.database : 'default';
    const username = 'username' in config ? config.username : 'default';
    return `${host || 'unknown-host'}|${database || 'default'}|${username || 'default'}`;
}
export function createQueryBuilder(config) {
    const { cache: cacheConfig, ...connectionConfig } = config;
    ClickHouseConnection.initialize(connectionConfig);
    const namespace = cacheConfig?.namespace || deriveNamespace(connectionConfig);
    const { runtime, cacheController } = initializeCacheRuntime(cacheConfig, namespace);
    return {
        cache: cacheController,
        async rawQuery(sql, params = []) {
            const client = ClickHouseConnection.getClient();
            const finalSQL = substituteParameters(sql, params);
            const result = await client.query({
                query: finalSQL,
                format: 'JSONEachRow'
            });
            return result.json();
        },
        table(tableName) {
            const state = {
                schema: {},
                tables: tableName,
                output: {},
                baseTable: tableName,
                base: {},
                aliases: {}
            };
            return new QueryBuilder(tableName, state, runtime);
        }
    };
}
