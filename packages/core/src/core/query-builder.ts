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

type AggregationType<T, Aggregations, Column, A extends string, Suffix extends string, HasSelect extends boolean> =
  HasSelect extends true
  ? { [K in keyof T | A]: K extends keyof T ? T[K] : string }
  : Aggregations extends Record<string, string>
  ? Aggregations & Record<A extends undefined ? `${Column & string}_${Suffix}` : A, string>
  : Record<A extends undefined ? `${Column & string}_${Suffix}` : A, string>;


function escapeValue(value: any): string {
  if (typeof value === 'boolean') {
    return value ? 'true' : 'false';
  }
  else if (typeof value === 'number') {
    return value.toString();
  } else if (typeof value === 'string') {
    // Escape single quotes by doubling them up.
    return `'${value.replace(/'/g, "''")}'`;
  } else if (value instanceof Date) {
    return `'${value.toISOString()}'`;
  } else {
    // For other types, JSON.stringify is a simple option
    return `'${JSON.stringify(value)}'`;
  }
}


function substituteParameters(sql: string, params: any[]): string {
  const parts = sql.split('?');
  if (parts.length - 1 !== params.length) {
    throw new Error(`Mismatch between placeholders and parameters. Found ${parts.length - 1} placeholders but ${params.length} parameters.`);
  }

  let substitutedSql = '';
  for (let i = 0; i < params.length; i++) {
    substitutedSql += parts[i] + escapeValue(params[i]);
  }
  substitutedSql += parts[parts.length - 1];

  return substitutedSql;
}


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
  parameters?: any[];
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

  /**
 * Creates an aggregation (COUNT, SUM, AVG etc) on a column
 * @param column The column to aggregate
 * @param fn The aggregation function (e.g., 'COUNT', 'SUM')
 * @param alias The alias to append to the column name (e.g., 'count', 'sum')
 */
  private createAggregation<Column extends keyof OriginalT, Alias extends string>(
    column: Column,
    fn: 'COUNT' | 'SUM' | 'AVG' | 'MIN' | 'MAX',
    alias: Alias
  ) {
    const newBuilder = this.clone();
    const aggregationSQL = `${fn}(${String(column)}) AS ${alias}`;

    if (this.config.select) {
      newBuilder.config = {
        ...this.config,
        select: [...(this.config.select || []).map(String), aggregationSQL],
        groupBy: (this.config.select || []).map(String).filter(col => !col.includes(' AS '))
      };
    } else {
      newBuilder.config = {
        ...this.config,
        select: [aggregationSQL]
      };
    }

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
    return this.createAggregation(
      column,
      'SUM',
      alias || `${String(column)}_sum`
    ) as any;
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
    return this.createAggregation(
      column,
      'COUNT',
      alias || `${String(column)}_count`
    );
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
    return this.createAggregation(
      column,
      'AVG',
      alias || `${String(column)}_avg`
    ) as any;
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
    return this.createAggregation(
      column,
      'MIN',
      alias || `${String(column)}_min`
    ) as any;
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
    return this.createAggregation(
      column,
      'MAX',
      alias || `${String(column)}_max`
    ) as any;
  }


  toSQLWithParams(): { sql: string, parameters: any[] } {
    const sql = this.toSQLWithoutParameters();
    const parameters = this.config.parameters || [];
    return { sql, parameters };
  }

  toSQL(): string {
    const { sql, parameters } = this.toSQLWithParams();
    return substituteParameters(sql, parameters);
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
    const { sql, parameters } = this.toSQLWithParams();

    const finalSQL = substituteParameters(sql, parameters);

    // Make sure your client supports passing the parameters.
    const result = await client.query({
      query: finalSQL,
      format: 'JSONEachRow'
    } as any)

    return result.json<T[]>();
  }

  private addCondition<K extends keyof T | TableColumn<Schema>>(
    conjunction: 'AND' | 'OR',
    column: K,
    operator: FilterOperator,
    value: any
  ) {
    this.config.where = this.config.where || [];

    if (operator === 'in' || operator === 'notIn') {
      if (!Array.isArray(value)) {
        throw new Error(`Expected an array for ${operator} operator, but got ${typeof value}`);
      }
      // Add the condition with the raw array value for special handling later.
      this.config.where.push({
        column: String(column),
        operator,
        value, // keep the array intact so that formatWhere maps over it.
        conjunction
      });
      if (!this.config.parameters) {
        this.config.parameters = [];
      }
      // Append each element of the array to the parameters list.
      for (const v of value) {
        this.config.parameters.push(v);
      }
    } else {
      const placeholder = '?';
      this.config.where.push({
        column: String(column),
        operator,
        value: placeholder,
        conjunction
      });
      if (!this.config.parameters) {
        this.config.parameters = [];
      }
      this.config.parameters.push(value);
    }
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
    this.addCondition('AND', column, operator, value);
    return this;
  }

  orWhere<K extends keyof T | TableColumn<Schema>>(
    column: K,
    operator: FilterOperator,
    value: any
  ): this {
    this.addCondition('OR', column, operator, value);
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
  having(condition: string, parameters?: any[]): this {
    this.config.having = this.config.having || [];
    this.config.having.push(condition);
    if (parameters && parameters.length > 0) {
      if (!this.config.parameters) {
        this.config.parameters = [];
      }
      this.config.parameters.push(...parameters);
    }
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
  toSQLWithoutParameters(): string {
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
        if (operator === 'in' || operator === 'notIn') {
          if (!Array.isArray(value)) {
            throw new Error(`Expected an array for ${operator} operator, but got ${typeof value}`);
          }
          if (value.length === 0) {
            return `${prefix}1 = 0`;
          }
          const placeholders = value.map(() => '?').join(', ');
          return `${prefix}${column} ${operator === 'in' ? 'IN' : 'NOT IN'} (${placeholders})`.trim();
        } else if (operator === 'between') {
          return `${prefix}${column} BETWEEN ? AND ?`.trim();
        } else if (operator === 'like') {
          return `${prefix}${column} LIKE ?`.trim();
        } else {
          return `${prefix}${column} ${this.getSqlOperator(operator)} ?`.trim();
        }
      })
      .join(' ');
  }

  private getSqlOperator(operator: FilterOperator): string {
    switch (operator) {
      case 'eq': return '=';
      case 'neq': return '!=';
      case 'gt': return '>';
      case 'gte': return '>=';
      case 'lt': return '<';
      case 'lte': return '<=';
      case 'like': return 'LIKE';
      default:
        throw new Error(`Unsupported operator: ${operator}`);
    }
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
    if (typeof value === 'string') return `${value}`;
    if (typeof value === 'boolean') return `${value}`;
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