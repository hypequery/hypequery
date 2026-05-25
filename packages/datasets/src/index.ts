// Dataset definition
export { dataset } from './dataset.js';

// Dimension helpers
export { dimension } from './field.js';

// Measure helpers
export { measure } from './measure.js';

// Relationship helpers
export { belongsTo, hasMany, hasOne } from './relationships.js';

// Aggregation helpers
export { sum, count, countDistinct, avg, min, max } from './aggregations.js';

// Formula helpers
export {
  divide, multiply, subtract, add,
  nullIfZero, coalesce,
  round, floor, ceil,
} from './formulas.js';

// Semantic query helpers
export {
  eq, neq, gt, gte, lt, lte,
  inList, notInList, between, like,
  asc, desc,
  filter, order,
} from './query-helpers.js';

// Registry
export { createDatasetRegistry } from './registry.js';

// Executor
export { MetricExecutor } from './executor.js';
export type { MetricExecutorOptions } from './executor.js';
export {
  buildDatasetQueryBuilder,
  runDatasetQuery,
  validateDatasetQuery,
} from './dataset-query.js';
export type { DatasetQueryExecutionOptions } from './dataset-query.js';

// Validation
export type { ValidationResult } from './validation.js';
export { validateFilterValue, matchesFieldType } from './validation.js';

// Query builder protocol (duck-typed interfaces for DB-agnostic builder usage)
export type { QueryBuilderLike, QueryBuilderFactoryLike } from './query-builder-protocol.js';

// SQL utilities
export { validateSQLIdentifier, isSafeSQLIdentifier, quoteSQLIdentifier } from './sql-utils.js';

// Constants
export { GRAIN_FUNCTIONS } from './constants.js';

// Types
export type {
  FieldType,
  DimensionType,
  DimensionOptions,
  DimensionDefinition,
  MeasureOptions,
  MeasureDefinition,
  InferDimensionType,
  RelationshipKind,
  RelationshipDefinition,
  AggregationType,
  MeasureAggregation,
  AggregationSpec,
  FormulaExpr,
  DerivedMetricSpec,
  TimeGrain,
  MetricRef,
  BaseMetricRef,
  DerivedMetricRef,
  GrainedMetricRef,
  MetricContract,
  MetricFilter,
  MetricOrderBy,
  MetricQuery,
  DatasetQuery,
  MetricResultMeta,
  MetricResult,
  DatasetQueryResult,
  MetricHandle,
  ExecutionContext,
  SemanticExecutionRuntime,
  SemanticTenantRuntime,
  SemanticFilterDefinition,
  SemanticFiltersDefinition,
  DatasetConfig,
  DatasetLimits,
  DatasetInstance,
  BaseMetricConfig,
  DerivedMetricConfig,
  DatasetRegistryInstance,
  DatasetFieldNames,
} from './types.js';
