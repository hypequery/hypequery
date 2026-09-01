// Dataset definition
export { dataset } from './dataset.js';

// Dimension helpers
export { dimension } from './field.js';

// Measure helpers
export { measure } from './measure.js';

// Relationship helpers
export { belongsTo, hasMany, hasOne } from './relationships.js';

// Aggregation helpers
export { sum, count, countDistinct, avg, min, max, percentile, median, argMax, argMin, stddev, variance } from './aggregations.js';

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
export { getDatasetCatalog, getDatasetCatalogs, getQueryableRelationshipFields } from './catalog.js';
export { listQueryableRelationshipFields } from './utils/relationship-fields.js';
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

// Portable deployment contract adapter
export { buildProtocolDatasetContract } from './protocol-adapter.js';
export type { BuildProtocolDatasetContractOptions } from './protocol-adapter.js';

// SQL portability compiler (R1A-07)
export {
  compilePortableSqlExpression,
  DEFAULT_SQL_PORTABILITY_LIMITS,
} from './sql-portability.js';
export type {
  SqlPortabilityIssue,
  SqlPortabilityIssueCode,
  SqlPortabilityLimits,
  SqlPortabilityOptions,
  SqlPortabilityResult,
} from './sql-portability.js';
export type {
  SemanticContract,
  SerializeSemanticContractOptions,
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

// Canonical semantic query schemas shared by Serve, MCP, and agent adapters.
export {
  buildDatasetInputSchema,
  buildMetricInputSchema,
  buildCanonicalSemanticQuerySchemas,
  toSemanticJsonSchema,
  DEFAULT_SEMANTIC_QUERY_SCHEMA_LIMITS,
} from './semantic-query-schema.js';
export type {
  CanonicalSemanticQuerySchemas,
  SemanticQuerySchemaLimits,
  SemanticQuerySchemaOptions,
  SemanticQuerySchemaSource,
} from './semantic-query-schema.js';
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

// Semantic query result cache
export { createMemoryCacheStore } from './cache/semantic-query-cache.js';
export type {
  SemanticCacheEntry,
  SemanticCacheMetaInfo,
  SemanticCacheOptions,
  SemanticCacheRuntime,
  SemanticCacheStats,
  SemanticCacheStore,
} from './cache/semantic-query-cache.js';
export {
  buildDatasetQuerySignature,
  buildMetricQuerySignature,
} from './cache/query-signature.js';
// Plan/backend protocol — FROZEN. Deprecated in favor of the query-builder
// path (`createDatasetClient({ queryBuilder })`); bug fixes only, no new
// features. See the deprecation notes on each declaration.
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
export type {
  QueryBuilderLike,
  QueryBuilderFactoryLike,
  QueryBuilderFactoryCompatible,
  QueryBuilderFactoryInput,
} from './query-builder-protocol.js';
export { toQueryBuilderFactory } from './query-builder-protocol.js';

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
  DatasetCachePolicy,
  DatasetInstance,
  AnyDatasetInstance,
  BaseMetricConfig,
  DerivedMetricConfig,
  DatasetRegistryInstance,
  DatasetFieldNames,
  DatasetDimensionNames,
  DatasetQueryableDimensions,
  DatasetMeasureNames,
  DatasetOrderableNames,
  DatasetQueryFor,
  DatasetRow,
  DatasetRowFor,
  DatasetQueryResultFor,
  MetricQueryFor,
  MetricRow,
  MetricRowFor,
  MetricResultFor,
  KnownStringKeys,
} from './types.js';
