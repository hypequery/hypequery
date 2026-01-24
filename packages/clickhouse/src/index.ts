export { createQueryBuilder, QueryBuilder } from './core/query-builder.js';
export { ClickHouseConnection } from './core/connection.js';
export { JoinRelationships } from './core/join-relationships.js';

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
export type { QueryLog, LogLevel, LoggerOptions } from './core/utils/logger.js';

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
