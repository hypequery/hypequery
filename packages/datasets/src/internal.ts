/**
 * Internal APIs for @hypequery/serve package only.
 *
 * These exports are NOT part of the public API and should not be used
 * by end users. They are implementation details that the serve package
 * needs to create endpoints.
 *
 * DO NOT import from this file in user code!
 */

// Executor - used by serve to create metric/dataset endpoints
export { createExecutor, SemanticExecutor, MetricExecutor } from './executor.js';
export type { SemanticExecutorOptions, MetricExecutorOptions } from './executor.js';
export { createInMemoryBackend } from './in-memory-backend.js';
export type { InMemoryTable, InMemoryTables } from './in-memory-backend.js';
export type {
  PlanNode,
  SemanticBackend,
  SemanticBackendResult,
  SemanticExpression,
  SemanticAggregationPlan,
  SemanticDimensionPlan,
  SemanticGrainPlan,
} from './semantic-plan.js';

// Query builder protocol - duck-typed interfaces for DB-agnostic execution
export type {
  QueryBuilderLike,
  QueryBuilderFactoryLike
} from './query-builder-protocol.js';

// Validation - used by serve for query validation
export type { ValidationResult } from './validation.js';
export { validateFilterValue, matchesFieldType } from './validation.js';

// SQL utilities - used by serve for SQL generation
export {
  validateSQLIdentifier,
  isSafeSQLIdentifier,
  quoteSQLIdentifier
} from './sql-utils.js';

// Dataset query execution - used by serve for dataset endpoints
export {
  runDatasetQuery,
  buildDatasetQueryBuilder,
  validateDatasetQuery
} from './dataset-query.js';
export type { DatasetQueryExecutionOptions } from './dataset-query.js';

// Constants - used by serve
export { GRAIN_FUNCTIONS } from './constants.js';

// Additional types that serve needs
export type {
  AnyDatasetInstance,
  DatasetQuery,
  DatasetQueryResult,
} from './types.js';
