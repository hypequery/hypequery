/**
 * Database adapter interface — the contract between the semantic layer and any database backend.
 *
 * The semantic layer (models, datasets) programs against this interface.
 * Each database (ClickHouse, Postgres, etc.) provides its own implementation.
 */

export type JoinType = 'inner' | 'left' | 'right' | 'full';

export type AggregateFunction = 'sum' | 'count' | 'avg' | 'min' | 'max' | 'countDistinct';

export type FilterOperator =
  | 'eq' | 'neq'
  | 'gt' | 'gte' | 'lt' | 'lte'
  | 'in' | 'notIn'
  | 'between'
  | 'like' | 'notLike';

export type OrderDirection = 'ASC' | 'DESC';

/**
 * A minimal, chainable query builder interface.
 * Database adapters wrap their native query builder to conform to this.
 */
export interface AdapterQueryBuilder {
  select(columns: string[]): this;
  where(column: string, operator: FilterOperator, value: unknown): this;
  join(type: JoinType, table: string, leftColumn: string, rightColumn: string): this;
  groupBy(columns: string[]): this;
  orderBy(column: string, direction: OrderDirection): this;
  limit(n: number): this;
  offset(n: number): this;
  aggregate(fn: AggregateFunction, column: string, alias: string): this;
  execute<T = Record<string, unknown>>(): Promise<T[]>;
  toSQL(): string;
}

/**
 * The database adapter that the semantic layer programs against.
 *
 * @typeParam Schema - A record mapping table names to their TypeScript row types.
 *   This is a "resolved" schema (TypeScript types, not DB-specific type strings).
 *
 * @example
 * ```ts
 * type MySchema = {
 *   orders: { id: number; amount: number; country: string; user_id: number };
 *   customers: { id: number; name: string; tier: string };
 * };
 *
 * const adapter: DatabaseAdapter<MySchema> = createClickHouseAdapter(config);
 * ```
 */
export interface DatabaseAdapter<Schema extends Record<string, Record<string, unknown>> = Record<string, Record<string, unknown>>> {
  query(table: Extract<keyof Schema, string>): AdapterQueryBuilder;
  rawQuery<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<T[]>;
}
