// SQL tagged template
export { sql, isSQLExpression, toSQLString } from './utils/sql-tag.js';
export type { SQLExpression } from './utils/sql-tag.js';

// Migrations config
export {
  defineConfig,
  resolveClickHouseConfig,
  DEFAULT_MIGRATIONS_OUT_DIR,
  DEFAULT_MIGRATIONS_PREFIX,
  DEFAULT_MIGRATIONS_TABLE,
} from './config/index.js';

// Schema definition
export {
  column,
  ClickHouseColumnBuilder,
  defineMaterializedView,
  defineSchema,
  defineTable,
} from './schema/index.js';

// Diff
export {
  diffSnapshots,
} from './diff/index.js';

// Plan
export {
  createMigrationPlan,
  isMigrationPlan,
} from './plan/index.js';

// Snapshot
export {
  serializeSchemaToSnapshot,
  snapshotToStableJson,
  hashSnapshot,
} from './snapshot/index.js';

// SQL rendering
export {
  renderMigrationArtifacts,
  writeMigrationArtifacts,
} from './sql/index.js';

// Config types
export type {
  ClickHouseClusterConfig,
  ClickHouseMigrationDbCredentials,
  ClickHouseMigrationDirectoryConfig,
  HypequeryClickHouseConfig,
  MigrationFilePrefix,
  ResolvedHypequeryClickHouseConfig,
} from './config/index.js';

// Schema types
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
} from './schema/index.js';

// Diff types
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
} from './diff/index.js';

// Plan types
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
} from './plan/index.js';

// SQL types
export type {
  MigrationMeta,
  RenderMigrationArtifactsInput,
  RenderMigrationArtifactsOptions,
  RenderMigrationArtifactsResult,
  WriteMigrationArtifactsOptions,
  WriteMigrationArtifactsResult,
} from './sql/index.js';

// Snapshot types
export type {
  Snapshot,
  SnapshotColumn,
  SnapshotColumnDefault,
  SnapshotDependencyEdge,
  SnapshotMaterializedView,
  SnapshotTable,
  SnapshotTableEngine,
} from './snapshot/index.js';
