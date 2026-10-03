import type { DatasetSqlDialect } from '../dataset-sql-dialect.js';
import type { QueryBuilderFactoryInput } from '../query-builder-protocol.js';
import { clickhouseDatasetSqlDialect } from './clickhouse-dataset-sql-dialect.js';

/** Resolve from the active factory, so a runtime builder override carries its dialect. */
export function resolveDatasetSqlDialect(factory: QueryBuilderFactoryInput): DatasetSqlDialect {
  return factory.datasetSqlDialect ?? clickhouseDatasetSqlDialect;
}
