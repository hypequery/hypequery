// Main library type definitions

// Export standard library components
export { createQueryBuilder } from './core/query-builder';
export { ClickHouseConnection } from './core/connection';
export type { ClickHouseConnectionOptions } from './core/connection';
export { JoinRelationships } from './core/join-relationships';
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

// CLI exports
export { generateTypes } from './cli/generate-types'; 