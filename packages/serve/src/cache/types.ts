/**
 * Cache entry stored in the cache store.
 */
export interface CacheEntry<T = unknown> {
  /** The cached value */
  value: T;
  /** Timestamp when the entry was created (ms since epoch) */
  createdAt: number;
  /** TTL in milliseconds */
  ttlMs: number;
  /** Optional stale-while-revalidate window in ms */
  staleWhileRevalidateMs?: number;
}

/**
 * Cache lookup result.
 */
export type CacheLookupResult<T = unknown> =
  | { status: 'hit'; value: T; age: number }
  | { status: 'stale'; value: T; age: number }
  | { status: 'miss' };

/**
 * Cache status for query events.
 */
export interface CacheStatus {
  /** Cache lookup result */
  status: 'hit' | 'miss' | 'stale' | 'bypass';
  /** Age of the cached entry in ms (only for hit/stale) */
  age?: number;
  /** TTL configured for this endpoint */
  ttlMs?: number;
  /** Cache key used */
  key?: string;
}

/**
 * Cache statistics.
 */
export interface CacheStats {
  /** Total cache hits */
  hits: number;
  /** Total cache misses */
  misses: number;
  /** Total stale hits (served stale while revalidating) */
  staleHits: number;
  /** Total queries that bypassed cache */
  bypassed: number;
  /** Hit rate (0-1) */
  hitRate: number;
  /** Total queries through cache layer */
  totalQueries: number;
  /** Average age of cache hits in ms */
  avgCacheAge: number;
  /** Number of entries currently in cache */
  entryCount: number;
  /** Approximate memory usage in bytes (if available) */
  memoryBytes?: number;
}

/**
 * Options for cache operations.
 */
export interface CacheSetOptions {
  /** TTL in milliseconds */
  ttlMs: number;
  /** Stale-while-revalidate window in ms */
  staleWhileRevalidateMs?: number;
}

/**
 * Cache store interface.
 * Implementations must be thread-safe for concurrent access.
 */
export interface CacheStore {
  /**
   * Get a value from the cache.
   * Returns the lookup result with status.
   */
  get<T = unknown>(key: string): Promise<CacheLookupResult<T>>;

  /**
   * Set a value in the cache.
   */
  set<T = unknown>(key: string, value: T, options: CacheSetOptions): Promise<void>;

  /**
   * Delete a specific key from the cache.
   */
  delete(key: string): Promise<boolean>;

  /**
   * Delete all entries matching a pattern.
   * Pattern supports * as wildcard (e.g., "users:*" deletes all user-related entries).
   */
  deletePattern(pattern: string): Promise<number>;

  /**
   * Clear all entries from the cache.
   */
  clear(): Promise<void>;

  /**
   * Check if a key exists in the cache (regardless of freshness).
   */
  has(key: string): Promise<boolean>;

  /**
   * Get cache statistics.
   */
  getStats(): CacheStats;

  /**
   * Reset statistics counters.
   */
  resetStats(): void;

  /**
   * Close the cache store and release resources.
   */
  close(): Promise<void>;
}

/**
 * Per-endpoint cache configuration.
 */
export interface EndpointCacheConfig {
  /**
   * TTL in milliseconds. Set to 0 or null to disable caching.
   */
  ttlMs: number | null;

  /**
   * Stale-while-revalidate window in ms.
   * When set, stale entries within this window are served immediately
   * while a background refresh is triggered.
   */
  staleWhileRevalidateMs?: number;

  /**
   * Custom cache key generator.
   * Default generates key from endpoint key + JSON-serialized input.
   * @param endpointKey The endpoint identifier
   * @param input The validated input
   * @returns Cache key string
   */
  keyGenerator?: (endpointKey: string, input: unknown) => string;

  /**
   * Condition to bypass cache.
   * Return true to skip cache lookup and always execute the query.
   * @param input The validated input
   * @param headers Request headers
   */
  bypass?: (input: unknown, headers: Record<string, string | undefined>) => boolean;
}

/**
 * Global cache configuration for ServeConfig.
 */
export interface ServeCacheConfig {
  /**
   * Cache store instance.
   * Defaults to in-memory store if not provided.
   */
  store?: CacheStore;

  /**
   * Default TTL for all endpoints (can be overridden per-endpoint).
   * Set to 0 or null to disable caching by default.
   */
  defaultTtlMs?: number | null;

  /**
   * Default stale-while-revalidate window.
   */
  defaultStaleWhileRevalidateMs?: number;

  /**
   * Default cache key generator.
   */
  defaultKeyGenerator?: (endpointKey: string, input: unknown) => string;

  /**
   * Maximum number of entries in the cache (for memory stores).
   * When exceeded, least-recently-used entries are evicted.
   */
  maxEntries?: number;

  /**
   * Whether to enable cache for all endpoints by default.
   * If false, only endpoints with explicit cache config are cached.
   * @default false
   */
  enableByDefault?: boolean;
}
