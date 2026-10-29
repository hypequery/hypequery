import * as schemas from './schemas.js';

// Dataset definition
export { dataset } from './dataset.js';

// Dimension helpers
export { dimension } from './field.js';

// Measure helpers
export { measure } from './measure.js';

// Relationship helpers
export { belongsTo, hasMany, hasOne } from './relationships.js';
export { checkRelationships } from './relationship-check.js';
export type {
  CheckRelationshipsOptions,
  CheckRelationshipsResult,
  RelationshipKeyIssue,
} from './relationship-check.js';

// Aggregation helpers
export {
  sum, count, countDistinct, approxCountDistinct, avg, min, max,
  percentile, median, argMax, argMin, stddev, variance, merge,
} from './aggregations.js';
export { AGGREGATE_STATE_FUNCTIONS, type AggregateStateFunction } from './utils/aggregate-state-functions.js';

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
  isNull, isNotNull,
  asc, desc,
  filter, order,
} from './query-helpers.js';

// Registry
export { createDatasetRegistry } from './registry.js';

// First-class publication builder for Serve, MCP, and agent consumers.
export { publishDatasets } from './publishing/publisher.js';
export type { DatasetPublisher } from './publishing/publisher.js';
export type {
  PublishableMetric,
  PublishedMetricHandle,
  PublishedMetricMap,
  PublishedMetrics,
  PublishedDataset,
  PublishedDatasetRegistry,
  PublishDatasetOptions,
} from './publishing/types.js';

// Catalog
export { getDatasetCatalog, getDatasetCatalogs, getQueryableRelationshipFields, getQueryableRelationshipMeasures } from './catalog.js';
export { listQueryableRelationshipFields } from './utils/relationship-fields.js';
export type {
  DatasetCatalog,
  DatasetCatalogMap,
  DatasetCatalogSource,
  DimensionCatalogEntry,
  MeasureCatalogEntry,
  SegmentCatalogEntry,
  MetricCatalogEntry,
  FilterCatalogEntry,
  RelationshipCatalogEntry,
} from './catalog.js';

// Agent-safe and separately authorized trusted-debug catalog projections.
export {
  DEFAULT_AGENT_CATALOG_MAX_BYTES,
  assertAgentSafeCatalogBudget,
  projectAgentSafeCatalog,
  projectTrustedDebugCatalog,
} from './agent-catalog.js';
export type {
  AgentCatalogDataset,
  AgentCatalogDatasetRegistry,
  AgentCatalogProjectionOptions,
  AgentCatalogDimension,
  AgentCatalogFilter,
  AgentCatalogMeasure,
  AgentCatalogSegment,
  AgentCatalogMetric,
  AgentCatalogRelationship,
  AgentCatalogSource,
  AgentSafeCatalog,
  TrustedDebugCatalog,
  TrustedDebugCatalogAuthorization,
} from './agent-catalog.js';

// Semantic contract (stable, hashable export for snapshots/diffs/validation)
export {
  serializeSemanticContract,
  contractToStableJson,
  hashContract,
  SEMANTIC_CONTRACT_VERSION,
} from './contract.js';

// Portable deployment contract adapter
export {
  rehydrateProtocolDatasets,
  UNSUPPORTED_CONTRACT_REASONS,
  UnsupportedContractFeatureError,
} from './protocol-rehydrate.js';
export type {
  RehydratedDataset,
  RehydrateProtocolDatasetsOptions,
  UnsupportedContractReason,
} from './protocol-rehydrate.js';
export { buildProtocolDatasetContract } from './protocol-adapter.js';
export { buildProtocolDeploymentContract } from './protocol-deployment-adapter.js';
export { assertDeployable } from './utils/deployable-formulas.js';
export type { BuildProtocolDeploymentContractOptions } from './protocol-deployment-adapter.js';
export { rehydrateProtocolDeploymentContract } from './protocol-rehydrate.js';
export type { BuildProtocolDatasetContractOptions } from './protocol-adapter.js';
export { publishToCloud } from './cloud-publishing.js';
export type { CloudPublishingOptions } from './cloud-publishing.js';

// Portable native execution of a semantic invocation (decision 0005).
export {
  createPortableSemanticExecutor,
  createPortableSemanticRuntime,
  PortableExecutionBudgetError,
  PortableExecutionTenantError,
  PortableExecutionUnsupportedError,
} from './portable-executor.js';
export type {
  PortableSemanticBudget,
  PortableSemanticRuntime,
  PortableDatasetCompilation,
  PortableSemanticExecutionInput,
  PortableSemanticExecutorOptions,
} from './portable-executor.js';

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

// Zod-backed schemas and agent tools now live at `@hypequery/datasets/schemas`.
// These root re-exports remain for compatibility and are removed in 1.0.

/** @deprecated Import from `@hypequery/datasets/schemas`; the root entry stops exporting it in 1.0. */
export const generateDatasetTools = schemas.generateDatasetTools;
/** @deprecated Import from `@hypequery/datasets/schemas`; the root entry stops exporting it in 1.0. */
export const toOpenAITools = schemas.toOpenAITools;
/** @deprecated Import from `@hypequery/datasets/schemas`; the root entry stops exporting it in 1.0. */
export const toAISDKTools = schemas.toAISDKTools;
/** @deprecated Import from `@hypequery/datasets/schemas`; the root entry stops exporting it in 1.0. */
export const toMcpTools = schemas.toMcpTools;
/** @deprecated Import from `@hypequery/datasets/schemas`; the root entry stops exporting it in 1.0. */
export const buildDatasetInputSchema = schemas.buildDatasetInputSchema;
/** @deprecated Import from `@hypequery/datasets/schemas`; the root entry stops exporting it in 1.0. */
export const buildMetricInputSchema = schemas.buildMetricInputSchema;
/** @deprecated Import from `@hypequery/datasets/schemas`; the root entry stops exporting it in 1.0. */
export const buildCanonicalSemanticQuerySchemas = schemas.buildCanonicalSemanticQuerySchemas;
/** @deprecated Import from `@hypequery/datasets/schemas`; the root entry stops exporting it in 1.0. */
export const toSemanticJsonSchema = schemas.toSemanticJsonSchema;
/** @deprecated Import from `@hypequery/datasets/schemas`; the root entry stops exporting it in 1.0. */
export const DEFAULT_SEMANTIC_QUERY_SCHEMA_LIMITS = schemas.DEFAULT_SEMANTIC_QUERY_SCHEMA_LIMITS;
/** @deprecated Import from `@hypequery/datasets/schemas`; the root entry stops exporting it in 1.0. */
export const buildDatasetInputProtocolSchema = schemas.buildDatasetInputProtocolSchema;
/** @deprecated Import from `@hypequery/datasets/schemas`; the root entry stops exporting it in 1.0. */
export const buildMetricInputProtocolSchema = schemas.buildMetricInputProtocolSchema;
/** @deprecated Import from `@hypequery/datasets/schemas`; the root entry stops exporting it in 1.0. */
export const zodToProtocolSchema = schemas.zodToProtocolSchema;
/** @deprecated Import from `@hypequery/datasets/schemas`; the root entry stops exporting it in 1.0. */
export const ProtocolSchemaAdapterError = schemas.ProtocolSchemaAdapterError;
/** @deprecated Import from `@hypequery/datasets/schemas`; the root entry stops exporting it in 1.0. */
export type ProtocolSchemaAdapterError = schemas.ProtocolSchemaAdapterError;
/** @deprecated Import from `@hypequery/datasets/schemas`; the root entry stops exporting it in 1.0. */
export const buildClientContractQuerySchemas = schemas.buildClientContractQuerySchemas;
/** @deprecated Import from `@hypequery/datasets/schemas`; the root entry stops exporting it in 1.0. */
export type CanonicalSemanticQuerySchemas = schemas.CanonicalSemanticQuerySchemas;
/** @deprecated Import from `@hypequery/datasets/schemas`; the root entry stops exporting it in 1.0. */
export type ClientContractQuerySchemas = schemas.ClientContractQuerySchemas;
/** @deprecated Import from `@hypequery/datasets/schemas`; the root entry stops exporting it in 1.0. */
export type ClientEndpointQuerySchema = schemas.ClientEndpointQuerySchema;

// Schema options and tool shapes are plain types with no Zod in them, so they
// stay available from the root entry too.
export type {
  SemanticMetricQueryContract,
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
export type { DatasetSqlDialect } from './dataset-sql-dialect.js';
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
export {
  GRAIN_FUNCTIONS, SEMANTIC_FILTER_OPERATORS, SEMANTIC_HAVING_OPERATORS, SEMANTIC_NULL_CHECK_OPERATORS, SUPPORTED_TIME_GRAINS,
} from './constants.js';

// Types
export type {
  FieldType,
  DimensionType,
  DimensionOptions,
  DimensionDefinition,
  MeasureOptions,
  MeasureDefinition,
  MeasureTimeInterval,
  WindowMeasureDefinition,
  ShiftMeasureDefinition,
  DatasetMeasureDefinition,
  DerivedMeasureDefinition,
  DerivedMeasureOptions,
  DerivedMeasureUses,
  InferDimensionType,
  RelationshipKind,
  RelationshipDefinition,
  RelationshipKey,
  RelationshipJoin,
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
  MetricFilterOperator,
  MetricNullCheckOperator,
  MetricValueFilterOperator,
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
  SegmentDefinition,
  SemanticFiltersDefinition,
  DatasetConfig,
  RowResolution,
  DatasetDefaults,
  DatasetFreshness,
  DatasetLimits,
  DatasetCachePolicy,
  SemanticMetadata,
  SemanticSensitivity,
  DatasetInstance,
  AnyDatasetInstance,
  BaseMetricConfig,
  DerivedMetricConfig,
  DatasetRegistryInstance,
  DatasetFieldNames,
  DatasetDimensionNames,
  DatasetQueryableDimensions,
  DatasetQueryableMeasures,
  DatasetMeasureNames,
  DatasetSegmentNames,
  DatasetTimeKeyNames,
  DatasetOrderableNames,
  DatasetQueryFor,
  DatasetHavingCondition,
  DatasetHavingFor,
  DatasetHavingOperator,
  DatasetRow,
  DatasetRowFor,
  DatasetQueryResultFor,
  MetricQueryFor,
  MetricRow,
  MetricRowFor,
  MetricResultFor,
  KnownStringKeys,
} from './types.js';

// Shared dataset compilation and structural diagnostics.
export type {
  DatasetCompilation, DatasetCompiledStatement, DatasetCompilationDescription,
} from './dataset-compilation.js';
export { DATASET_EXECUTION_CAPABILITIES } from './execution-capabilities.js';
export type { DatasetFeature, DatasetFeatureSupport, DatasetExecutionCapabilities } from './execution-capabilities.js';
export type { DatasetFilterNames, DatasetFilterFor } from './utils/dataset-filter-types.js';

