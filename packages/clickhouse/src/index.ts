export { createQueryBuilder, QueryBuilder } from './core/query-builder.js';
export { ClickHouseConnection } from './core/connection.js';
export { JoinRelationships } from './core/join-relationships.js';
export { createClickHouseAdapter, ClickHouseAdapter } from './core/adapters/clickhouse-adapter.js';
export { ClickHouseDialect } from './core/dialects/clickhouse-dialect.js';
export type { DatabaseAdapter } from './core/adapters/database-adapter.js';
export type { SqlDialect } from './core/dialects/sql-dialect.js';

// Re-export types for convenience
export type {
  ClickHouseConfig,
  ClickHouseClientConfig,
  CreateQueryBuilderConfig,
  ExecuteOptions
} from './core/query-builder.js';
export { isClientConfig } from './core/query-builder.js';
export type {
  CacheOptions,
  CacheConfig,
  CacheProvider,
  CacheEntry,
  CacheStatus
} from './core/cache/types.js';
export { CacheController } from './core/cache/controller.js';
export { MemoryCacheProvider } from './core/cache/providers/memory-lru.js';
export { MemoryCacheProvider as MemoryLRUCacheProvider } from './core/cache/providers/memory-lru.js';
export { NoopCacheProvider } from './core/cache/providers/noop.js';

// Re-export schema helpers + query utility types
export type {
  ColumnType,
  TableColumn,
  TableSchema,
  TableRecord,
  DatabaseSchema,
  InferColumnType,
} from './types/schema.js';
export type {
  OrderDirection,
  QueryConfig,
  AggregationType
} from './types/base.js';

// Re-export filter types
export type {
  FilterOperator,
  OperatorValueMap,
  FilterConditionInput
} from './types/filters.js';

export type { JoinPath, JoinPathOptions } from './core/join-relationships.js';
export { CrossFilter } from './core/cross-filter.js';
export { logger } from './core/utils/logger.js';

// Re-export SQL expression utilities
export {
  raw,
  rawAs,
  selectExpr,
  toDateTime,
  formatDateTime,
  toStartOfInterval,
  datePart
} from './core/utils/sql-expressions.js';

// Re-export SQL expression types
export type {
  SqlExpression,
  FormatDateTimeOptions,
  AliasedExpression
} from './core/utils/sql-expressions.js';

// Predicate expression types
export type {
  PredicateExpression,
  PredicateLiteral,
  PredicateBuilder,
  PredicateArg
} from './core/utils/predicate-builder.js';

// =============================================================================
// DATASET API (Phase 1)
// =============================================================================

// SQL tagged template
export { sql, isSQLExpression, toSQLString } from './dataset/sql-tag.js';
export type { SQLExpression } from './dataset/sql-tag.js';

// Dimension and metric helpers
export { dimension, metric } from './dataset/helpers.js';
export type { DimensionOptions, MetricOptions } from './dataset/helpers.js';

// Dataset types
export type {
  // Dimension types
  DimensionType,
  SimpleDimension,
  DimensionDefinition,
  Dimension,
  DimensionsMap,

  // Metric types
  MetricAggregationType,
  MetricFormat,
  MetricDefinition,
  MetricsMap,

  // Dataset types
  DatasetDefinition,
  DatasetsMap,
  TenantConfig,
  DatasetLimits,

  // Filter types
  DateRangeValue,
  FilterValue,
  FilterDefinition,
  Filters,

  // Order types
  SortDirection,
  OrderByDimension,
  OrderByMetric,
  OrderBy,

  // Query types
  DatasetQuery,
  QueryContext,
  QueryResultMetadata,
  QueryResult,

  // Type inference
  InferDimensionType,
  InferMetricType,
  InferQueryRowType,
  InferQueryResult,

  // Introspection types
  IntrospectedDimension,
  IntrospectedMetric,
  IntrospectedDataset,
} from './dataset/types.js';

// Dataset definition utilities
export {
  validateDatasetDefinition,
  validateDatasets,
  normalizeDimension,
  normalizeDimensions,
  inferDimensionType,
  getDimensionSQL,
  getMetricSQL,
  getDataset,
  listDatasets,
  hasDataset,
  getDimensionNames,
  getMetricNames,
  hasDimension,
  hasMetric,
  getDimension,
  getMetric,
} from './dataset/definition.js';

// Dataset introspection
export {
  introspectDimension,
  introspectMetric,
  getDatasetSchema,
  getAllDatasetSchemas,
  summarizeDataset,
  datasetsToJSON,
  summarizeAllDatasets,
} from './dataset/introspection.js';

// Migrations foundations
export {
  defineConfig,
  resolveClickHouseConfig,
  DEFAULT_MIGRATIONS_OUT_DIR,
  DEFAULT_MIGRATIONS_PREFIX,
  DEFAULT_MIGRATIONS_TABLE,
} from './migrations/config/index.js';
export {
  column,
  ClickHouseColumnBuilder,
  defineMaterializedView,
  defineSchema,
  defineTable,
} from './migrations/schema/index.js';
export {
  diffSnapshots,
} from './migrations/diff/index.js';
export {
  createMigrationPlan,
  isMigrationPlan,
} from './migrations/plan/index.js';
export {
  serializeSchemaToSnapshot,
  snapshotToStableJson,
  hashSnapshot,
} from './migrations/snapshot/index.js';
export {
  renderMigrationArtifacts,
  writeMigrationArtifacts,
} from './migrations/sql/index.js';

export type {
  ClickHouseClusterConfig,
  ClickHouseMigrationDbCredentials,
  ClickHouseMigrationDirectoryConfig,
  HypequeryClickHouseConfig,
  MigrationFilePrefix,
  ResolvedHypequeryClickHouseConfig,
} from './migrations/config/index.js';

export type {
  ClickHouseColumnDefinition,
  ClickHouseColumnBuilderLike,
  ClickHouseColumnDefaultValue,
  ClickHouseColumnType,
  ClickHouseDefaultInput,
  ClickHouseLowCardinalityColumnType,
  ClickHouseLiteralDefaultValue,
  ClickHouseMaterializedViewDefinition,
  ClickHouseMaterializedViewInputDefinition,
  ClickHouseNamedColumnType,
  ClickHouseNullableColumnType,
  ClickHouseSqlDefaultValue,
  ClickHouseSchemaAst,
  ClickHouseSchemaDefinition,
  ClickHouseSqlExpression,
  ClickHouseTableDefinition,
  ClickHouseTableInputDefinition,
  ClickHouseTableEngine,
} from './migrations/schema/index.js';
export type {
  AddColumnOperation,
  AlterTableWithDependentViewsOperation,
  CreateMaterializedViewOperation,
  CreateTableOperation,
  DiffWarning,
  DropColumnOperation,
  DropMaterializedViewOperation,
  DropTableOperation,
  MigrationOperation,
  ModifyColumnDefaultOperation,
  ModifyColumnTypeOperation,
  RecreateMaterializedViewOperation,
  SnapshotDiffResult,
  TableMutationOperation,
  UnsupportedChange,
} from './migrations/diff/index.js';
export type {
  ClickHouseMigrationSyncSetting,
  ClickHouseMigrationPlanContext,
  ClickHouseTableCostStats,
  CreateMigrationPlanOptions,
  MigrationPlanAnalyzer,
  MigrationPlanAnalyzerContext,
  MigrationPlanAnalyzerResult,
  MigrationOperationClassification,
  MigrationOperationCostEstimate,
  MigrationPlan,
  MigrationPlanBlocker,
  MigrationPlanConfirmation,
  MigrationPlanDiagnostic,
  MigrationPlanDiagnosticLevel,
  MigrationPlanInput,
  PlannedMigrationOperation,
} from './migrations/plan/index.js';
export type {
  MigrationMeta,
  RenderMigrationArtifactsInput,
  RenderMigrationArtifactsOptions,
  RenderMigrationArtifactsResult,
  WriteMigrationArtifactsOptions,
  WriteMigrationArtifactsResult,
} from './migrations/sql/index.js';

export type {
  Snapshot,
  SnapshotColumn,
  SnapshotColumnDefault,
  SnapshotDependencyEdge,
  SnapshotMaterializedView,
  SnapshotTable,
  SnapshotTableEngine,
} from './migrations/snapshot/index.js';
