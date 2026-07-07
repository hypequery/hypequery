/**
 * Duck-typed protocol interfaces for query builders.
 *
 * These interfaces define the minimal contract that a query builder must satisfy
 * to work with the semantic dataset client. The @hypequery/clickhouse `createQueryBuilder`
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

  // Analytical aggregations
  /** Value of `column` on the row where `argColumn` is greatest. */
  argMax(column: string, argColumn: string, alias?: string): QueryBuilderLike;
  /** Value of `column` on the row where `argColumn` is smallest. */
  argMin(column: string, argColumn: string, alias?: string): QueryBuilderLike;
  /** Approximate percentile of `column` at `level` in [0, 1]. */
  quantile(column: string, level: number, alias?: string): QueryBuilderLike;
  /** Sample standard deviation of `column`. */
  stddev(column: string, alias?: string): QueryBuilderLike;
  /** Sample variance of `column`. */
  variance(column: string, alias?: string): QueryBuilderLike;

  // Filtering
  where(column: string, operator: string, value: unknown): QueryBuilderLike;

  // Joins (to-one relationship traversal)
  leftJoin(
    table: string,
    leftColumn: string,
    rightColumn: string,
    alias?: string,
    on?: QueryBuilderJoinCondition | QueryBuilderJoinCondition[],
  ): QueryBuilderLike;

  // Grouping
  groupBy(columns: string | string[]): QueryBuilderLike;

  // Ordering / pagination
  orderBy(column: string, direction?: 'ASC' | 'DESC'): QueryBuilderLike;
  limit(count: number): QueryBuilderLike;
  offset(count: number): QueryBuilderLike;

  // Terminal operations
  toSQLWithParams(): { sql: string; parameters: unknown[] };
  execute<T = Record<string, unknown>>(): Promise<T[]>;
}

export interface QueryBuilderJoinCondition {
  column: string;
  operator: string;
  value: unknown;
}

/** A query builder factory (what `createQueryBuilder(config)` returns). */
export interface QueryBuilderFactoryLike {
  table(name: string): QueryBuilderLike;
  rawQuery<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<T[]>;
}

/**
 * Acceptance shape for query builder factories at public entry points.
 *
 * Schema-typed builders (e.g. `createQueryBuilder<Schema>` from
 * `@hypequery/clickhouse`) narrow column parameters to literal unions, type
 * `execute()` rows concretely, and overload `where`, so they cannot
 * structurally satisfy `QueryBuilderFactoryLike` even though they honor its
 * runtime contract. This looser shape admits both protocol-shaped and
 * schema-typed builders; entry points adapt with `toQueryBuilderFactory`.
 */
export interface QueryBuilderFactoryCompatible {
  table(name: never): unknown;
  rawQuery(sql: string, params?: never): Promise<unknown>;
}

/** Any query builder factory accepted by public entry points. */
export type QueryBuilderFactoryInput =
  | QueryBuilderFactoryLike
  | QueryBuilderFactoryCompatible;

/**
 * Adapts an accepted factory to the internal `QueryBuilderFactoryLike` call
 * contract. Safe because the semantic layer only calls protocol methods with
 * plain strings, which schema-typed builders handle at runtime.
 */
export function toQueryBuilderFactory(
  factory: QueryBuilderFactoryInput,
): QueryBuilderFactoryLike {
  return factory as QueryBuilderFactoryLike;
}
