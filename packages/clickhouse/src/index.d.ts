// Main library type definitions

// Export standard library components
export { createQueryBuilder } from './core/query-builder';
export { ClickHouseConnection } from './core/connection';
export { JoinRelationships } from './core/join-relationships';
export { createClickHouseAdapter, ClickHouseAdapter } from './core/adapters/clickhouse-adapter';
export { ClickHouseDialect } from './core/dialects/clickhouse-dialect';
export type { DatabaseAdapter } from './core/adapters/database-adapter';
export type { SqlDialect } from './core/dialects/sql-dialect';
export type {
  ColumnType,
  TableSchema,
  TableRecord,
  DatabaseSchema,
} from './types/schema';
export type {
  QueryConfig,
  WhereExpression,
  GroupByExpression,
  OrderDirection,
  AggregationType
} from './types/base';
export type { JoinPath, JoinPathOptions } from './core/join-relationships';
export { CrossFilter } from './core/cross-filter';
export { logger } from './core/utils/logger';
export {
  raw,
  rawAs,
  selectExpr,
  toDateTime,
  formatDateTime,
  toStartOfInterval,
  datePart,
  FormatDateTimeOptions
} from './core/utils/sql-expressions';
export type {
  SqlExpression,
  AliasedExpression
} from './core/utils/sql-expressions';

export type {
  PredicateExpression,
  PredicateLiteral,
  PredicateBuilder,
  PredicateArg
} from './core/utils/predicate-builder';

// CLI exports
export { generateTypes } from './cli/generate-types'; 

// Migration foundations
export {
  defineConfig,
  resolveClickHouseConfig,
  DEFAULT_MIGRATIONS_OUT_DIR,
  DEFAULT_MIGRATIONS_PREFIX,
  DEFAULT_MIGRATIONS_TABLE,
} from './migrations/config';
export {
  column,
  ClickHouseColumnBuilder,
  defineMaterializedView,
  defineSchema,
  defineTable,
} from './migrations/schema';
export {
  serializeSchemaToSnapshot,
  snapshotToStableJson,
  hashSnapshot,
} from './migrations/snapshot';

export type {
  ClickHouseClusterConfig,
  ClickHouseMigrationDbCredentials,
  ClickHouseMigrationDirectoryConfig,
  HypequeryClickHouseConfig,
  MigrationFilePrefix,
  ResolvedHypequeryClickHouseConfig,
} from './migrations/config';

export type {
  ClickHouseColumnBuilderLike,
  ClickHouseColumnDefinition,
  ClickHouseColumnType,
  ClickHouseLowCardinalityColumnType,
  ClickHouseMaterializedViewDefinition,
  ClickHouseMaterializedViewInputDefinition,
  ClickHouseNamedColumnType,
  ClickHouseNullableColumnType,
  ClickHouseSchemaAst,
  ClickHouseSchemaDefinition,
  ClickHouseSqlExpression,
  ClickHouseTableDefinition,
  ClickHouseTableInputDefinition,
  ClickHouseTableEngine,
} from './migrations/schema';

export type {
  Snapshot,
  SnapshotColumn,
  SnapshotDependencyEdge,
  SnapshotMaterializedView,
  SnapshotTable,
  SnapshotTableEngine,
} from './migrations/snapshot';
