export { createQueryBuilder, QueryBuilder } from './core/query-builder';
export { ClickHouseConnection } from './core/connection';
export { JoinRelationships } from './core/join-relationships';
export type {
  ClickHouseConfig,
  ClickHouseClientConfig
} from './core/query-builder';
export { isClientConfig } from './core/query-builder';
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
export type { JoinPath, JoinPathOptions } from './core/join-relationships';
export { CrossFilter } from './core/cross-filter';
export { logger } from './core/utils/logger';
export {
  raw,
  rawAs,
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

// Note: CLI functionality is deliberately not exported from the main package
// This prevents Node.js-specific modules from being included in browser bundles
