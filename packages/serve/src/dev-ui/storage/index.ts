/**
 * Storage module for query history persistence.
 * Provides interfaces and implementations for storing and querying
 * execution history in the dev server.
 */

// Type exports
export type {
  QueryHistoryEntry,
  CacheStatsSnapshot,
  RetentionPolicy,
  GetQueriesOptions,
  GetQueriesResult,
  QueryHistoryStore
} from './types.js';

// Implementation exports
export { SQLiteStore } from './sqlite-store.js';
