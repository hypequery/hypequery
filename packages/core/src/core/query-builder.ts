import { ClickHouseConnection } from './connection';
import { FilterOperator, JoinType, JoinClause, ColumnType } from './types';

export type OrderDirection = 'ASC' | 'DESC';

interface WhereCondition {
  column: string;
  operator: FilterOperator;
  value: any;
  conjunction: 'AND' | 'OR';
}

type TableColumn<Schema> = {
  [Table in keyof Schema]: `${string & Table}.${string & keyof Schema[Table]}`
}[keyof Schema] | keyof Schema[keyof Schema];

export interface QueryConfig<T, Schema> {
  select?: Array<keyof T | string>;
  where?: WhereCondition[];
  groupBy?: string[];
  having?: string[];
  limit?: number;
  offset?: number;
  distinct?: boolean;
  orderBy?: Array<{
    column: keyof T | TableColumn<Schema>;
    direction: OrderDirection;
  }>;
  joins?: JoinClause[];
}

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

  constructor(
    tableName: string,
    schema: { name: string; columns: T },
    originalSchema: Schema
  ) {
    this.tableName = tableName;
    this.schema = schema;
    this.originalSchema = originalSchema
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
  } & Aggregations, true, Aggregations, OriginalT> {
    type NewT = {
      [P in K as P extends `${string}.${infer C}` ? C : P]: P extends keyof T ? (
        T[P] extends "String" ? string :
        T[P] extends "Date" ? Date :
        T[P] extends "Float64" | "Int32" | "Int64" ? number : never
      ) : string;
    };

    const newBuilder = new QueryBuilder<Schema, NewT & Aggregations, true, Aggregations, OriginalT>(
      this.tableName,
      { name: this.schema.name, columns: {} as NewT & Aggregations },
      this.originalSchema
    );
    newBuilder.config = { ...this.config, select: columns as string[] };
    return newBuilder;
  }

  /**
 * Creates an aggregation (COUNT, SUM, AVG etc) on a column
 * @param column The column to aggregate
 * @param fn The aggregation function (e.g., 'COUNT', 'SUM')
 * @param alias The alias to append to the column name (e.g., 'count', 'sum')
 */
  private createAggregation<Column extends keyof T, Alias extends string>(
    column: Column,
    fn: 'COUNT' | 'SUM' | 'AVG' | 'MIN' | 'MAX',
    alias: Alias
  ): QueryBuilder<
    Schema,
    T & { [K in Alias]: string },
    HasSelect,
    Aggregations & { [K in Alias]: string },
    OriginalT
  > {
    const newBuilder = this.clone();
    const aggregationSQL = `${fn}(${String(column)}) AS ${alias}`;

    if (this.config.select) {
      newBuilder.config = {
        ...this.config,
        select: [...this.config.select, aggregationSQL].map(String)
      };
      newBuilder.config.groupBy = this.config.select.filter(col => !col.includes(' AS '));
    } else {
      newBuilder.config = {
        ...this.config,
        select: [aggregationSQL].map(String)
      };
    }

    return newBuilder as any;
  }

  sum<A extends keyof T, Alias extends string = `${A & string}_sum`>(
    column: A,
    alias?: Alias
  ): QueryBuilder<
    Schema,
    T & { [K in typeof alias extends undefined ? `${A & string}_sum` : Alias]: string },
    HasSelect,
    Aggregations & { [K in typeof alias extends undefined ? `${A & string}_sum` : Alias]: string },
    OriginalT
  > {
    return this.createAggregation(
      column,
      'SUM',
      alias || `${String(column)}_sum`
    ) as any;
  }

  count<A extends keyof T, Alias extends string>(column: A, alias?: Alias) {
    return this.createAggregation(column, 'COUNT', alias || `${String(column)}_count`);
  }

  avg<A extends keyof T, Alias extends string>(column: A, alias?: Alias) {
    return this.createAggregation(column, 'AVG', alias || `${String(column)}_avg`);
  }

  min<A extends keyof T, Alias extends string>(column: A, alias?: Alias) {
    return this.createAggregation(column, 'MIN', alias || `${String(column)}_min`);
  }

  max<A extends keyof T, Alias extends string>(column: A, alias?: Alias) {
    return this.createAggregation(column, 'MAX', alias || `${String(column)}_max`);
  }

  /**
   * Executes the query and returns the results.
   * @returns {Promise<T[]>} Array of results matching the query
   * @example
   * ```ts
   * const results = await builder.select(['id', 'name']).where('active', 'eq', true).execute()
   * ```
   */
  async execute(): Promise<T[]> {
    const client = ClickHouseConnection.getClient();
    const result = await client.query({
      query: this.toSQL(),
      format: 'JSONEachRow'
    });

    return result.json<T[]>();
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
  where<K extends keyof T | TableColumn<Schema>>(
    column: K,
    operator: FilterOperator,
    value: any
  ): this {
    this.config.where = this.config.where || [];
    this.config.where.push({
      column: String(column),
      operator,
      value,
      conjunction: 'AND'
    });
    return this;
  }

  orWhere<K extends keyof T | TableColumn<Schema>>(
    column: K,
    operator: FilterOperator,
    value: any
  ): this {
    this.config.where = this.config.where || [];
    this.config.where.push({
      column: String(column),
      operator,
      value,
      conjunction: 'OR'
    });
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
    this.config.groupBy = Array.isArray(columns)
      ? columns.map(String)
      : [String(columns)];
    return this;
  }

  limit(count: number): this {
    this.config.limit = count;
    return this;
  }

  offset(count: number): this {
    this.config.offset = count;
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
  orderBy<K extends keyof T | TableColumn<Schema>>(column: K, direction: OrderDirection = 'ASC'): this {
    this.config.orderBy = this.config.orderBy || [];
    this.config.orderBy.push({ column, direction });
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
  having(condition: string): this {
    this.config.having = this.config.having || [];
    this.config.having.push(condition);
    return this;
  }

  distinct(): this {
    this.config.distinct = true;
    return this;
  }

  whereBetween(
    column: keyof typeof this.originalSchema.columns,
    [min, max]: [number | string | Date, number | string | Date]
  ): this {
    if (min === null || max === null) {
      throw new Error('BETWEEN values cannot be null');
    }
    return this.where(column, 'between', [min, max]);
  }

  private addJoin<TableName extends keyof Schema>(
    type: JoinType,
    table: TableName,
    leftColumn: keyof OriginalT,
    rightColumn: `${TableName & string}.${keyof Schema[TableName] & string}`,
    alias?: string
  ): QueryBuilder<Schema, T, HasSelect, Aggregations, OriginalT> {
    const newBuilder = this.clone();
    newBuilder.config.joins = [
      ...(this.config.joins || []),
      { type, table: String(table), leftColumn: String(leftColumn), rightColumn, alias }
    ];
    return newBuilder as any;
  }

  /**
   * Performs an INNER JOIN with another table.
   * @template TableName - The name of the table to join with
   * @param {TableName} table - The table to join
   * @param {keyof T} leftColumn - The column from the current table
   * @param {string} rightColumn - The column from the joined table in format 'table.column'
   * @param {string} [alias] - Optional alias for the joined table
   * @returns {QueryBuilder} A new QueryBuilder instance with joined table types
   * @example
   * ```ts
  * builder.innerJoin('users', 'user_id', 'users.id')
  * ```
   */
  innerJoin<
    TableName extends keyof Schema
  >(
    table: TableName,
    leftColumn: keyof OriginalT,
    rightColumn: `${TableName & string}.${keyof Schema[TableName] & string}`,
    alias?: string
  ): QueryBuilder<Schema, T, HasSelect, Aggregations, OriginalT> {
    return this.addJoin('INNER', table, leftColumn, rightColumn, alias);
  }

  leftJoin<
    TableName extends keyof Schema
  >(
    table: TableName,
    leftColumn: keyof OriginalT,
    rightColumn: `${TableName & string}.${keyof Schema[TableName] & string}`,
    alias?: string
  ): QueryBuilder<Schema, T, HasSelect, Aggregations, OriginalT> {
    return this.addJoin('LEFT', table, leftColumn, rightColumn, alias);
  }

  rightJoin<
    TableName extends keyof Schema  // The table we're joining to
  >(
    table: TableName,
    leftColumn: keyof OriginalT,
    rightColumn: `${TableName & string}.${keyof Schema[TableName] & string}`,
    alias?: string
  ): QueryBuilder<Schema, T, HasSelect, Aggregations, OriginalT> {
    return this.addJoin('RIGHT', table, leftColumn, rightColumn, alias);
  }

  fullJoin<
    TableName extends keyof Schema
  >(
    table: TableName,
    leftColumn: keyof OriginalT,
    rightColumn: `${TableName & string}.${keyof Schema[TableName] & string}`,
    alias?: string
  ): QueryBuilder<Schema, T, HasSelect, Aggregations, OriginalT> {
    return this.addJoin('FULL', table, leftColumn, rightColumn, alias);
  }

  /**
   * Converts the query to its SQL string representation.
   * @returns {string} The SQL query string
   * @example
   * ```ts
  * const sql = builder.select(['id']).where('active', 'eq', true).toSQL()
    * // SELECT id FROM table WHERE active = true
   * ```
   */
  toSQL(): string {
    const parts: string[] = [`SELECT ${this.formatSelect()}`];
    parts.push(`FROM ${this.tableName}`);

    if (this.config.joins?.length) {
      parts.push(this.formatJoins());
    }

    if (this.config.where?.length) {
      parts.push(`WHERE ${this.formatWhere()}`);
    }

    if (this.config.groupBy?.length) {
      parts.push(`GROUP BY ${this.formatGroupBy()}`);
    }

    if (this.config.having?.length) {
      parts.push(`HAVING ${this.config.having.join(' AND ')}`);
    }

    if (this.config.orderBy?.length) {
      const orderBy = this.config.orderBy
        .map(({ column, direction }) => `${String(column)} ${direction}`.trim())
        .join(', ');
      parts.push(`ORDER BY ${orderBy}`);
    }

    if (this.config.limit) {
      const offsetClause = this.config.offset ? `OFFSET ${this.config.offset}` : '';
      parts.push(`LIMIT ${this.config.limit} ${offsetClause}`);
    }

    return parts.join(' ').trim()
  }

  private formatSelect(): string {
    const distinctClause = this.config.distinct ? 'DISTINCT ' : '';
    if (!this.config.select?.length) return distinctClause + '*';
    return distinctClause + this.config.select.join(', ');
  }

  private formatGroupBy(): string {
    const groupBy = this.config.groupBy;
    if (Array.isArray(groupBy)) {
      return groupBy.join(', ');
    }
    return String(groupBy);
  }

  private formatWhere(): string {
    if (!this.config.where?.length) return '';

    return this.config.where
      .map((condition, index) => {
        const { column, operator, value, conjunction } = condition;
        const prefix = index === 0 ? '' : ` ${conjunction} `;

        switch (operator) {
          case 'eq':
            return `${prefix} ${column} = ${this.formatValue(value).trim()}`.trim();
          case 'neq':
            return `${prefix} ${column} != ${this.formatValue(value).trim()} `.trim();
          case 'gt':
            return `${prefix} ${column} > ${this.formatValue(value).trim()}`.trim();
          case 'gte':
            return `${prefix} ${column} >= ${this.formatValue(value).trim()}`.trim();
          case 'lt':
            return `${prefix} ${column} < ${this.formatValue(value).trim()}`.trim();
          case 'lte':
            return `${prefix} ${column} <= ${this.formatValue(value).trim()}`.trim();
          case 'like':
            return `${prefix} ${column} LIKE ${this.formatValue(value).trim()}`.trim();
          case 'in':
            return `${prefix} ${column} IN (${(value as any[]).map(v => this.formatValue(v)).join(', ')})`.trim();
          case 'notIn':
            return `${prefix} ${column} NOT IN(${(value as any[]).map(v => this.formatValue(v)).join(', ')})`.trim();
          case 'between':
            const [min, max] = value as [any, any];
            return `${prefix} ${column} BETWEEN ${this.formatValue(min)} AND ${this.formatValue(max).trim()}`.trim();
          default:
            throw new Error(`Unsupported operator: ${operator}`);
        }
      })
      .join(' ');
  }

  private formatJoins(): string {
    return this.config.joins!.map(join => {
      const tableClause = join.alias
        ? `${join.table} AS ${join.alias}`
        : join.table;
      return `${join.type} JOIN ${tableClause} ON ${join.leftColumn} = ${join.rightColumn}`;
    }).join(' ')
  }

  private formatValue(value: any): string {
    if (value === null) return 'NULL';
    if (typeof value === 'string') return `'${value}'`;
    if (value instanceof Date) return value.toISOString().split('T')[0];
    return String(value);
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