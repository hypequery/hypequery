/**
 * Query log entry compatible with @hypequery/clickhouse QueryLog.
 * Defined locally so @hypequery/serve has no hard dependency on clickhouse.
 */
export interface QueryLog {
  query: string;
  parameters?: any[];
  startTime: number;
  endTime?: number;
  duration?: number;
  status: 'started' | 'completed' | 'error';
  error?: Error;
  rowCount?: number;
  queryId?: string;
  cacheStatus?: string;
  cacheKey?: string;
  cacheMode?: string;
  cacheAgeMs?: number;
  cacheRowCount?: number;
}

/**
 * Extended query log entry with additional metadata for storage and display.
 */
export interface QueryHistoryEntry extends QueryLog {
  /** Auto-incrementing database ID */
  id?: number;
  /** Unique identifier for this query execution */
  queryId: string;
  /** Key identifying the endpoint that executed this query */
  endpointKey?: string;
  /** URL path of the endpoint */
  endpointPath?: string;
  /** Preview of query results (first few rows) */
  resultPreview?: any[];
  /** Timestamp when entry was created in storage */
  createdAt?: number;
}

/**
 * Snapshot of cache performance statistics.
 * Aggregated from query history entries with cache metadata.
 */
export interface CacheStatsSnapshot {
  /** Number of cache hits (fresh data served from cache) */
  hits: number;
  /** Number of cache misses (data fetched from source) */
  misses: number;
  /** Number of stale cache hits (stale data served while revalidating) */
  staleHits: number;
  /** Number of background revalidations triggered */
  revalidations: number;
  /** Ratio of (hits + staleHits) / total cache-enabled queries */
  hitRate: number;
}

/**
 * Configuration for automatic cleanup of old query history entries.
 */
export interface RetentionPolicy {
  /** Maximum number of queries to retain */
  maxQueries: number;
  /** Maximum age in days for query entries */
  maxDays: number;
}

/**
 * Options for querying stored query history.
 */
export interface GetQueriesOptions {
  /** Maximum number of results to return (default: 50) */
  limit?: number;
  /** Number of results to skip for pagination */
  offset?: number;
  /** Filter by query execution status */
  status?: 'started' | 'completed' | 'error';
  /** Search term to filter queries by SQL text */
  search?: string;
}

/**
 * Result of a query history search with pagination metadata.
 */
export interface GetQueriesResult {
  /** Array of matching query history entries */
  queries: QueryHistoryEntry[];
  /** Total count of matching entries (before pagination) */
  total: number;
}

/**
 * Interface for query history storage implementations.
 * Supports multiple backends (SQLite, PostgreSQL, etc.)
 */
export interface QueryHistoryStore {
  /**
   * Initialize the storage backend.
   * Creates necessary tables/schemas if they don't exist.
   */
  initialize(): Promise<void>;

  /**
   * Insert multiple query logs in a single transaction.
   * More efficient than individual inserts for bulk operations.
   * @param logs - Array of query logs with required queryId
   */
  batchInsert(logs: Array<QueryLog & { queryId: string }>): Promise<void>;

  /**
   * Add a single query log entry.
   * Convenience method that wraps batchInsert.
   * @param log - Query log with required queryId
   */
  addQuery(log: QueryLog & { queryId: string }): Promise<void>;

  /**
   * Retrieve query history entries with filtering and pagination.
   * @param options - Query options for filtering and pagination
   * @returns Paginated results with total count
   */
  getQueries(options: GetQueriesOptions): Promise<GetQueriesResult>;

  /**
   * Retrieve a single query by its unique ID.
   * @param queryId - The unique query identifier
   * @returns The query entry or null if not found
   */
  getQuery(queryId: string): Promise<QueryHistoryEntry | null>;

  /**
   * Calculate aggregate cache performance statistics.
   * @returns Cache stats snapshot with hit rates
   */
  getCacheStats(): Promise<CacheStatsSnapshot>;

  /**
   * Apply retention policy to remove old entries.
   * Removes entries exceeding maxQueries or older than maxDays.
   * @param policy - Retention policy configuration
   */
  cleanup(policy: RetentionPolicy): Promise<void>;

  /**
   * Export all query history to a portable format.
   * Useful for migration or backup purposes.
   * @param format - Export format (currently only 'json' supported)
   * @returns Serialized data string
   */
  export(format: 'json'): Promise<string>;

  /**
   * Import query history from an exported format.
   * Merges imported data with existing entries.
   * @param data - Serialized data string
   * @param format - Import format (currently only 'json' supported)
   */
  import(data: string, format: 'json'): Promise<void>;

  /**
   * Remove all query history entries.
   * Preserves the schema/tables.
   */
  clear(): Promise<void>;

  /**
   * Close the storage connection and release resources.
   * Should be called on application shutdown.
   */
  close(): Promise<void>;
}
