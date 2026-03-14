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

// Serve integration
export { createMetricEndpoint } from './metric-endpoint.js';

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
