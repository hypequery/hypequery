import type { AnyDatasetInstance, DatasetQuery, DatasetQueryResult, ExecutionContext } from './types.js';
import type { QueryBuilderFactoryLike } from './query-builder-protocol.js';
import type { ValidationResult } from './validation.js';
import { validateDatasetQueryInput } from './utils/dataset-query-validation.js';
import { prepareDatasetQuery } from './utils/compile-dataset-query.js';
import { toDatasetQueryResult } from './utils/dataset-query-result.js';

// Preserve the shipped builder helper while keeping compilation helpers focused.
export { buildDatasetQueryBuilder } from './utils/build-dataset-query-builder.js';

export interface DatasetQueryExecutionOptions {
  builderFactory: QueryBuilderFactoryLike;
  context?: ExecutionContext;
  /**
   * Overrides the SQL `LIMIT` without affecting validation (which still uses
   * `query.limit`). Used to over-fetch one row for pagination's `hasMore`.
   */
  executionLimit?: number;
  /** Internal: the grouped subquery is unordered; the derived outer query orders results. */
  skipDefaultOrderBy?: boolean;
}

export function validateDatasetQuery(
  ds: AnyDatasetInstance,
  query: DatasetQuery,
  context?: ExecutionContext,
): ValidationResult {
  return validateDatasetQueryInput(ds, query, context);
}

export async function runDatasetQuery(
  ds: AnyDatasetInstance,
  query: DatasetQuery,
  options: DatasetQueryExecutionOptions,
): Promise<DatasetQueryResult> {
  const start = Date.now();
  const prepared = prepareDatasetQuery(ds, query, options);
  const rows = await prepared.execute();
  return toDatasetQueryResult(rows, {
    dataset: ds,
    query: prepared.compilation.query,
    sql: prepared.compilation.sql,
    timingMs: Date.now() - start,
    context: options.context,
  });
}
