import type { DatasetSqlDialect } from '@hypequery/datasets/internal';
import type { PostgresDriver, PostgresQueryOptions } from './driver/driver.js';
import { createPgDriver, type PgDriverOptions } from './driver/pg-driver.js';
import { postgresDatasetSqlDialect } from './dialect/postgres-dataset-sql-dialect.js';
import { requireDriver } from './features/executor.js';
import { PostgresQueryBuilder } from './postgres-query-builder.js';
import { createSelectNode } from './query-node.js';

export type CreatePostgresQueryBuilderOptions =
  | { readonly driver: PostgresDriver }
  | PgDriverOptions
  /** Compile only: `toSQL` works, executing throws. */
  | Record<string, never>;

/** What `createPostgresQueryBuilder` returns: pass it to `createDatasetClient({ queryBuilder })`. */
export interface PostgresQueryBuilderFactory {
  /** Postgres spelling for everything the datasets planner emits. */
  readonly datasetSqlDialect: DatasetSqlDialect;
  table(name: string): PostgresQueryBuilder;
  rawQuery<T = Record<string, unknown>>(
    sql: string,
    params?: unknown[],
    options?: PostgresQueryOptions,
  ): Promise<T[]>;
}

/**
 * Create a Postgres query builder for hypequery datasets.
 *
 * ```ts
 * import pg from 'pg';
 * import { createPostgresQueryBuilder } from '@hypequery/postgres';
 * import { createDatasetClient } from '@hypequery/datasets';
 *
 * const queryBuilder = createPostgresQueryBuilder({ pool: new pg.Pool({ connectionString }) });
 * const client = createDatasetClient({ queryBuilder });
 * ```
 */
export function createPostgresQueryBuilder(options: CreatePostgresQueryBuilderOptions = {}): PostgresQueryBuilderFactory {
  const driver = resolveDriver(options);
  return Object.freeze({
    datasetSqlDialect: postgresDatasetSqlDialect,
    table: (name: string) => new PostgresQueryBuilder({ node: createSelectNode(name), ...(driver ? { driver } : {}) }),
    rawQuery: <T>(sql: string, params: unknown[] = [], queryOptions?: PostgresQueryOptions) =>
      requireDriver(driver).query<T>(sql, params, queryOptions),
  });
}

function resolveDriver(options: CreatePostgresQueryBuilderOptions): PostgresDriver | undefined {
  if ('driver' in options && options.driver) return options.driver as PostgresDriver;
  if ('pool' in options && options.pool) return createPgDriver(options as PgDriverOptions);
  return undefined;
}
