import type { AnyDatasetInstance, DatasetQuery } from '../types.js';
import { buildDatasetQueryBuilder, type DatasetQueryExecutionOptions } from '../dataset-query.js';
import { selectedTimeMeasures } from './time-query-measures.js';
import { buildTimeMeasureDatasetSql } from './time-measure-dataset-sql.js';
import { hasSelectedDerivedMeasure, buildDerivedDatasetSql } from './dataset-derived-query.js';

/** Compile the selected base, derived or time-measure query without executing. */
export function compileDatasetQuery(
  ds: AnyDatasetInstance,
  query: DatasetQuery,
  options: DatasetQueryExecutionOptions,
): { sql: string; parameters: unknown[] } {
  if (selectedTimeMeasures(ds, query).size) {
    return buildTimeMeasureDatasetSql(ds, query, options);
  }
  if (hasSelectedDerivedMeasure(ds, query)) {
    return buildDerivedDatasetSql(ds, query, options, buildDatasetQueryBuilder);
  }
  return buildDatasetQueryBuilder(ds, query, options).toSQLWithParams();
}

