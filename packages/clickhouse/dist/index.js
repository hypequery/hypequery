// Main entry point
export { createQueryBuilder } from './core/query-builder.js';
export { ClickHouseConnection } from './core/connection.js';
export { JoinRelationships } from './core/join-relationships.js';
export { CrossFilter } from './core/cross-filter.js';
export { logger } from './core/utils/logger.js';
export { CacheController } from './core/cache/controller.js';
export { MemoryCacheProvider } from './core/cache/providers/memory-lru.js';
export { MemoryCacheProvider as MemoryLRUCacheProvider } from './core/cache/providers/memory-lru.js';
export { NoopCacheProvider } from './core/cache/providers/noop.js';
export {
  raw,
  rawAs,
  toDateTime,
  formatDateTime,
  toStartOfInterval,
  datePart
} from './core/utils/sql-expressions.js';

// Note: CLI functionality is deliberately not exported from the main package
// This prevents Node.js-specific modules from being included in browser bundles
