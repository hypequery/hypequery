import type {
  QueryLog,
  QueryHistoryStore,
  QueryHistoryEntry,
  CacheStatsSnapshot,
  RetentionPolicy,
  GetQueriesOptions,
  GetQueriesResult
} from './types.js';

/**
 * In-memory implementation of QueryHistoryStore.
 * Ideal for development, testing, and environments where SQLite is unavailable.
 * Uses FIFO eviction when maxQueries limit is reached.
 */
export class MemoryStore implements QueryHistoryStore {
  /** Map for O(1) lookups by queryId */
  private queries: Map<string, QueryHistoryEntry> = new Map();
  /** Array maintaining insertion order for FIFO eviction and ordering */
  private orderedIds: string[] = [];
  /** Auto-incrementing ID counter */
  private nextId: number = 1;

  /**
   * Create a new in-memory store.
   * @param maxQueries - Maximum number of queries to retain (default: 1000)
   */
  constructor(private maxQueries: number = 1000) {}

  /**
   * Initialize the store (no-op for in-memory).
   */
  async initialize(): Promise<void> {
    // No initialization needed for in-memory store
  }

  /**
   * Insert multiple query logs.
   * @param logs - Array of query logs with required queryId
   */
  async batchInsert(logs: Array<QueryLog & { queryId: string }>): Promise<void> {
    for (const log of logs) {
      await this.addQuery(log);
    }
  }

  /**
   * Add a single query log entry.
   * Updates existing entry if queryId already exists.
   * Evicts oldest entry if maxQueries limit is reached.
   * @param log - Query log with required queryId
   */
  async addQuery(log: QueryLog & { queryId: string; endpointKey?: string; endpointPath?: string }): Promise<void> {
    const existing = this.queries.get(log.queryId);

    if (existing) {
      // Update existing entry
      const entry: QueryHistoryEntry = {
        ...existing,
        ...log,
        id: existing.id,
        createdAt: existing.createdAt
      };
      this.queries.set(log.queryId, entry);
    } else {
      // Check if we need to evict
      if (this.orderedIds.length >= this.maxQueries) {
        const oldestId = this.orderedIds.shift();
        if (oldestId) {
          this.queries.delete(oldestId);
        }
      }

      // Add new entry
      const entry: QueryHistoryEntry = {
        id: this.nextId++,
        queryId: log.queryId,
        endpointKey: log.endpointKey,
        endpointPath: log.endpointPath,
        query: log.query,
        parameters: log.parameters,
        startTime: log.startTime,
        endTime: log.endTime,
        duration: log.duration,
        status: log.status,
        error: log.error,
        rowCount: log.rowCount,
        cacheStatus: log.cacheStatus,
        cacheKey: log.cacheKey,
        cacheMode: log.cacheMode,
        cacheAgeMs: log.cacheAgeMs,
        createdAt: Date.now()
      };

      this.queries.set(log.queryId, entry);
      this.orderedIds.push(log.queryId);
    }
  }

  /**
   * Retrieve query history entries with filtering and pagination.
   * @param options - Query options for filtering and pagination
   * @returns Paginated results with total count
   */
  async getQueries(options: GetQueriesOptions): Promise<GetQueriesResult> {
    const limit = options.limit || 50;
    const offset = options.offset || 0;

    // Get all entries in reverse order (most recent first)
    let entries = [...this.orderedIds]
      .reverse()
      .map(id => this.queries.get(id)!)
      .filter(Boolean);

    // Apply filters
    if (options.status) {
      entries = entries.filter(e => e.status === options.status);
    }

    if (options.search) {
      const searchLower = options.search.toLowerCase();
      entries = entries.filter(e => e.query.toLowerCase().includes(searchLower));
    }

    const total = entries.length;

    // Apply pagination
    const queries = entries.slice(offset, offset + limit);

    return { queries, total };
  }

  /**
   * Retrieve a single query by its unique ID.
   * @param queryId - The unique query identifier
   * @returns The query entry or null if not found
   */
  async getQuery(queryId: string): Promise<QueryHistoryEntry | null> {
    return this.queries.get(queryId) || null;
  }

  /**
   * Calculate aggregate cache performance statistics.
   * @returns Cache stats snapshot with hit rates
   */
  async getCacheStats(): Promise<CacheStatsSnapshot> {
    let hits = 0;
    let misses = 0;
    let staleHits = 0;
    let revalidations = 0;

    for (const entry of this.queries.values()) {
      switch (entry.cacheStatus) {
        case 'hit':
          hits++;
          break;
        case 'miss':
          misses++;
          break;
        case 'stale-hit':
          staleHits++;
          break;
        case 'revalidate':
          revalidations++;
          break;
      }
    }

    const total = hits + misses + staleHits;
    const hitRate = total > 0 ? (hits + staleHits) / total : 0;

    return { hits, misses, staleHits, revalidations, hitRate };
  }

  /**
   * Apply retention policy to remove old entries.
   * @param policy - Retention policy configuration
   */
  async cleanup(policy: RetentionPolicy): Promise<void> {
    const cutoffTime = Date.now() - (policy.maxDays * 24 * 60 * 60 * 1000);

    // Remove entries older than maxDays
    const idsToRemove: string[] = [];
    for (const [id, entry] of this.queries) {
      if (entry.startTime < cutoffTime) {
        idsToRemove.push(id);
      }
    }

    for (const id of idsToRemove) {
      this.queries.delete(id);
      const idx = this.orderedIds.indexOf(id);
      if (idx !== -1) {
        this.orderedIds.splice(idx, 1);
      }
    }

    // Remove oldest entries if we exceed maxQueries
    while (this.orderedIds.length > policy.maxQueries) {
      const oldestId = this.orderedIds.shift();
      if (oldestId) {
        this.queries.delete(oldestId);
      }
    }
  }

  /**
   * Export all query history to JSON format.
   * @param format - Export format (currently only 'json' supported)
   * @returns JSON string of all query history entries
   */
  async export(format: 'json'): Promise<string> {
    const entries = this.orderedIds.map(id => this.queries.get(id)!).filter(Boolean);
    return JSON.stringify(entries, null, 2);
  }

  /**
   * Import query history from JSON format.
   * @param data - JSON string of query history entries
   * @param format - Import format (currently only 'json' supported)
   */
  async import(data: string, format: 'json'): Promise<void> {
    const entries = JSON.parse(data) as QueryHistoryEntry[];
    for (const entry of entries) {
      await this.addQuery({
        queryId: entry.queryId,
        query: entry.query,
        parameters: entry.parameters,
        startTime: entry.startTime,
        endTime: entry.endTime,
        duration: entry.duration,
        status: entry.status,
        error: entry.error,
        rowCount: entry.rowCount,
        cacheStatus: entry.cacheStatus,
        cacheKey: entry.cacheKey,
        cacheMode: entry.cacheMode,
        cacheAgeMs: entry.cacheAgeMs,
        endpointKey: entry.endpointKey,
        endpointPath: entry.endpointPath
      });
    }
  }

  /**
   * Remove all query history entries.
   */
  async clear(): Promise<void> {
    this.queries.clear();
    this.orderedIds = [];
  }

  /**
   * Close the store (no-op for in-memory).
   */
  async close(): Promise<void> {
    // No cleanup needed for in-memory store
  }

  /**
   * Get the current number of stored queries.
   */
  get size(): number {
    return this.queries.size;
  }
}
