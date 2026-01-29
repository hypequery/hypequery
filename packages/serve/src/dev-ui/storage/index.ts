/**
 * Storage module for query history persistence.
 * Provides interfaces and implementations for storing and querying
 * execution history in the dev server.
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import type { QueryHistoryStore, RetentionPolicy } from './types.js';
import { SQLiteStore } from './sqlite-store.js';
import { MemoryStore } from './memory-store.js';

// Type exports
export type {
  QueryLog,
  QueryHistoryEntry,
  CacheStatsSnapshot,
  RetentionPolicy,
  GetQueriesOptions,
  GetQueriesResult,
  QueryHistoryStore
} from './types.js';

// Implementation exports
export { SQLiteStore } from './sqlite-store.js';
export { MemoryStore } from './memory-store.js';

/**
 * Options for creating a query history store.
 */
export interface StorageOptions {
  /** Path to SQLite database file. Defaults to '.hypequery/dev.db' in cwd */
  dbPath?: string;
  /** Retention policy for automatic cleanup */
  retention?: Partial<RetentionPolicy>;
  /** Force in-memory storage even if SQLite is available */
  forceMemory?: boolean;
  /** Maximum queries for in-memory fallback (default: 1000) */
  maxMemoryQueries?: number;
  /** Suppress console output */
  silent?: boolean;
}

/**
 * Default retention policy values.
 */
const DEFAULT_RETENTION: RetentionPolicy = {
  maxQueries: 10000,
  maxDays: 30
};

/**
 * Create a query history store with automatic fallback.
 *
 * Attempts to create a SQLite store for persistence. If SQLite is unavailable
 * (missing native module, permissions, etc.), falls back to in-memory storage.
 *
 * @param options - Storage configuration options
 * @returns Initialized QueryHistoryStore instance
 *
 * @example
 * ```typescript
 * // Default configuration
 * const store = await createStore();
 *
 * // Custom path and retention
 * const store = await createStore({
 *   dbPath: '/custom/path/history.db',
 *   retention: { maxQueries: 5000, maxDays: 7 }
 * });
 *
 * // Force in-memory storage
 * const store = await createStore({ forceMemory: true });
 * ```
 */
export async function createStore(options: StorageOptions = {}): Promise<QueryHistoryStore> {
  const dbPath = options.dbPath || path.join(process.cwd(), '.hypequery', 'dev.db');
  const retention: RetentionPolicy = {
    maxQueries: options.retention?.maxQueries ?? DEFAULT_RETENTION.maxQueries,
    maxDays: options.retention?.maxDays ?? DEFAULT_RETENTION.maxDays
  };
  const maxMemoryQueries = options.maxMemoryQueries ?? 1000;
  const silent = options.silent ?? false;

  const log = (message: string) => {
    if (!silent) {
      console.log(`[hypequery] ${message}`);
    }
  };

  const warn = (message: string, error?: Error) => {
    if (!silent) {
      console.warn(`[hypequery] ${message}`, error?.message || '');
    }
  };

  // Force in-memory if requested
  if (options.forceMemory) {
    log(`Using in-memory storage (forced)`);
    const store = new MemoryStore(maxMemoryQueries);
    await store.initialize();
    return store;
  }

  try {
    // Create directory if it doesn't exist
    const dir = path.dirname(dbPath);
    await fs.mkdir(dir, { recursive: true });

    // Try SQLite
    const store = new SQLiteStore(dbPath);
    await store.initialize();

    // Apply retention policy
    await store.cleanup(retention);

    log(`SQLite storage: ${dbPath}`);
    log(`Retention: ${retention.maxQueries} queries, ${retention.maxDays} days`);

    return store;
  } catch (error) {
    warn(`SQLite unavailable, using in-memory storage:`, error as Error);

    const store = new MemoryStore(maxMemoryQueries);
    await store.initialize();

    return store;
  }
}
