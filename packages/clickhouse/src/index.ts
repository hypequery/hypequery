export { createQueryBuilder } from './core/query-builder.js';
export { ClickHouseConnection } from './core/connection.js';
export { JoinRelationships } from './core/join-relationships.js';
export type {
  ClickHouseConfig,
  ClickHouseHostConfig,
  ClickHouseClientConfig
} from './core/query-builder.js';
export { isHostConfig, isClientConfig } from './core/query-builder.js';
export type {
  TableSchema,
  QueryConfig,
  ColumnType,
  WhereExpression,
  GroupByExpression,
  TableRecord,
  DatabaseSchema,
  PaginatedResult,
  PageInfo,
  PaginationOptions
} from './types/base';
export type { JoinPath, JoinPathOptions } from './core/join-relationships.js';
export { CrossFilter } from './core/cross-filter.js';
export { logger } from './core/utils/logger.js';
export {
  raw,
  rawAs,
  toDateTime,
  formatDateTime,
  toStartOfInterval,
  datePart,
  FormatDateTimeOptions
} from './core/utils/sql-expressions.js';
export type {
  SqlExpression,
  AliasedExpression
} from './core/utils/sql-expressions.js';

// Note: CLI functionality is deliberately not exported from the main package
// This prevents Node.js-specific modules from being included in browser bundles
