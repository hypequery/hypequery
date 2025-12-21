export { createQueryBuilder, QueryBuilder } from './core/query-builder.js';
export { ClickHouseConnection } from './core/connection.js';
export { JoinRelationships } from './core/join-relationships.js';

// Re-export types for convenience
export type {
  ClickHouseConfig,
  ClickHouseClientConfig
} from './core/query-builder.js';
export { isClientConfig } from './core/query-builder.js';

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
  PaginationOptions,
  PaginatedResult,
  PageInfo,
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
