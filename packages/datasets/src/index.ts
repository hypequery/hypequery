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

// Catalog
export { getDatasetCatalog, getDatasetCatalogs } from './catalog.js';
export type {
  DatasetCatalog,
  DatasetCatalogMap,
  DatasetCatalogSource,
  DimensionCatalogEntry,
  MeasureCatalogEntry,
  MetricCatalogEntry,
  FilterCatalogEntry,
  RelationshipCatalogEntry,
} from './catalog.js';

// Semantic contract (stable, hashable export for snapshots/diffs/validation)
export {
  serializeSemanticContract,
  contractToStableJson,
  hashContract,
  SEMANTIC_CONTRACT_VERSION,
} from './contract.js';
export type {
  SemanticContract,
  ContractDataset,
  ContractDimension,
  ContractMeasure,
  ContractMetric,
  ContractFilter,
  ContractRelationship,
} from './contract.js';

// Agent/tool metadata
export {
  generateDatasetTools,
  toOpenAITools,
  toAISDKTools,
  toMcpTools,
} from './tools.js';
export type {
  AISDKToolDefinition,
  DatasetToolAnalytics,
  DatasetToolMode,
  GenerateDatasetToolsOptions,
  JsonSchema,
  McpToolDefinition,
  OpenAIToolDefinition,
  SemanticToolDefinition,
} from './tools.js';

// Dataset client
export { createDatasetClient } from './executor.js';
export type { DatasetClient, CreateDatasetClientOptions } from './executor.js';
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

// Validation
export type { ValidationResult } from './validation.js';
export { validateFilterValue, matchesFieldType } from './validation.js';

// Query builder protocol (duck-typed interfaces for DB-agnostic builder usage)
export type { QueryBuilderLike, QueryBuilderFactoryLike } from './query-builder-protocol.js';

// SQL utilities
export { validateSQLIdentifier, isSafeSQLIdentifier, quoteSQLIdentifier } from './sql-utils.js';

// Constants
export { GRAIN_FUNCTIONS, SEMANTIC_FILTER_OPERATORS, SUPPORTED_TIME_GRAINS } from './constants.js';

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
  AnyDatasetInstance,
  BaseMetricConfig,
  DerivedMetricConfig,
  DatasetRegistryInstance,
  DatasetFieldNames,
  DatasetDimensionNames,
  DatasetMeasureNames,
  DatasetOrderableNames,
  DatasetQueryFor,
  DatasetRow,
  DatasetQueryResultFor,
  MetricQueryFor,
  MetricRow,
  MetricResultFor,
} from './types.js';
