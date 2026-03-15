// Dataset definition
export { dataset } from './dataset.js';

// Field helpers
export { field } from './field.js';

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

// Registry
export { createDatasetRegistry } from './registry.js';

// Executor
export { MetricExecutor } from './executor.js';
export type { MetricAdapter, MetricExecutorOptions, ValidationResult } from './executor.js';

// Query builder protocol (duck-typed interfaces for DB-agnostic builder usage)
export type { QueryBuilderLike, QueryBuilderFactoryLike } from './query-builder-protocol.js';

// Serve integration
export { createMetricEndpoint } from './metric-endpoint.js';
export { createDatasetEndpoint } from './dataset-endpoint.js';

// Standalone block factories
export { defineMetrics } from './define-metrics.js';
export type { MetricsBlock, MetricEntryInput, MetricsInput, DefineMetricsOptions } from './define-metrics.js';
export { defineDatasets } from './define-datasets.js';
export type { DatasetsBlock, DatasetEntryInput, DatasetsInput, DefineDatasetsOptions } from './define-datasets.js';

// Types
export type {
  FieldType,
  FieldOptions,
  FieldDefinition,
  InferFieldType,
  RelationshipKind,
  RelationshipDefinition,
  AggregationType,
  AggregationSpec,
  FormulaExpr,
  DerivedMetricSpec,
  TimeGrain,
  MetricRef,
  GrainedMetricRef,
  MetricContract,
  MetricFilter,
  MetricOrderBy,
  MetricQuery,
  MetricResultMeta,
  MetricResult,
  ExecutionContext,
  DatasetConfig,
  DatasetLimits,
  DatasetInstance,
  BaseMetricConfig,
  DerivedMetricConfig,
  DatasetRegistryInstance,
  DatasetFieldNames,
} from './types.js';
