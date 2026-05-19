/**
 * Duck-typed protocol interfaces for query builders.
 *
 * These interfaces define the minimal contract that a query builder must satisfy
 * to work with the MetricExecutor. The @hypequery/clickhouse `createQueryBuilder`
 * return value satisfies `QueryBuilderFactoryLike` structurally — no explicit
 * `implements` is needed.
 *
 * This keeps @hypequery/serve DB-agnostic while enabling first-class builder usage.
 */

/** A chainable query builder instance (what `.table(name)` returns). */
export interface QueryBuilderLike {
  select(columns: string[] | string): QueryBuilderLike;

  // Aggregations
  sum(column: string, alias?: string): QueryBuilderLike;
  count(column: string, alias?: string): QueryBuilderLike;
  countDistinct(column: string, alias?: string): QueryBuilderLike;
  avg(column: string, alias?: string): QueryBuilderLike;
  min(column: string, alias?: string): QueryBuilderLike;
  max(column: string, alias?: string): QueryBuilderLike;

  // Filtering
  where(column: string, operator: string, value: unknown): QueryBuilderLike;

  // Grouping
  groupBy(columns: string | string[]): QueryBuilderLike;

  // Ordering / pagination
  orderBy(column: string, direction?: 'ASC' | 'DESC'): QueryBuilderLike;
  limit(count: number): QueryBuilderLike;
  offset(count: number): QueryBuilderLike;

  // Terminal operations
  toSQLWithParams(): { sql: string; parameters: unknown[] };
  execute(): Promise<Record<string, unknown>[]>;
}

/** A query builder factory (what `createQueryBuilder(config)` returns). */
export interface QueryBuilderFactoryLike {
  table(name: string): QueryBuilderLike;
  rawQuery<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<T[]>;
}
