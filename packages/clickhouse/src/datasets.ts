import {
  type SemanticBackend,
  type SemanticExecutor,
} from '@hypequery/datasets';
export {
  add,
  asc,
  avg,
  belongsTo,
  between,
  ceil,
  coalesce,
  count,
  countDistinct,
  dataset,
  desc,
  dimension,
  divide,
  eq,
  filter,
  floor,
  gt,
  gte,
  hasMany,
  hasOne,
  inList,
  like,
  lt,
  lte,
  max,
  measure,
  min,
  multiply,
  neq,
  notInList,
  nullIfZero,
  order,
  round,
  subtract,
  sum,
} from '@hypequery/datasets';
export type {
  DatasetInstance,
  DatasetQuery,
  DatasetQueryResult,
  MetricQuery,
  MetricResult,
} from '@hypequery/datasets';
import { createQueryBuilder } from './core/query-builder.js';
import type { CreateQueryBuilderConfig } from './core/query-builder.js';
import type { SchemaDefinition } from './core/types/builder-state.js';
import { createClickHouseSemanticBackendFromQueryBuilder } from './semantic-backend.js';

export type ClickHouseDatasetClient = SemanticExecutor;
export type CreateDatasetClientConfig = CreateQueryBuilderConfig;

export function createClickHouseSemanticBackend<Schema extends SchemaDefinition<Schema>>(
  config: CreateDatasetClientConfig,
): SemanticBackend {
  return createClickHouseSemanticBackendFromQueryBuilder(
    createQueryBuilder<Schema>(config),
  );
}

export function createDatasetClient<Schema extends SchemaDefinition<Schema>>(
  config: CreateDatasetClientConfig,
): ClickHouseDatasetClient {
  return createQueryBuilder<Schema>(config).datasets();
}
