import Database from 'better-sqlite3';
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
 * SQLite-based implementation of QueryHistoryStore.
 * Uses better-sqlite3 for synchronous, high-performance SQLite operations.
 * Ideal for local development and single-instance deployments.
 */
export class SQLiteStore implements QueryHistoryStore {
  private db: Database.Database | null = null;

  /**
   * Create a new SQLite store instance.
   * @param dbPath - Path to the SQLite database file.
   *                 Use ':memory:' for in-memory database (useful for testing).
   */
  constructor(private dbPath: string) {}

  /**
   * Initialize the database connection and create schema.
   * Creates tables and indexes if they don't exist.
   */
  async initialize(): Promise<void> {
    this.db = new Database(this.dbPath);

    // Enable WAL mode for better concurrent read performance
    this.db.pragma('journal_mode = WAL');

    this.db.exec(`
      CREATE TABLE IF NOT EXISTS query_history (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        query_id TEXT UNIQUE NOT NULL,
        endpoint_key TEXT,
        endpoint_path TEXT,
        query TEXT NOT NULL,
        parameters TEXT,
        started_at INTEGER NOT NULL,
        completed_at INTEGER,
        duration_ms INTEGER,
        status TEXT NOT NULL CHECK(status IN ('started', 'completed', 'error')),
        error_message TEXT,
        row_count INTEGER,
        cache_status TEXT CHECK(cache_status IN ('hit', 'miss', 'stale-hit', 'revalidate', 'bypass') OR cache_status IS NULL),
        cache_key TEXT,
        cache_mode TEXT,
        cache_age_ms INTEGER,
        result_preview TEXT,
        created_at INTEGER DEFAULT (strftime('%s','now') * 1000)
      );

      CREATE INDEX IF NOT EXISTS idx_started_at ON query_history(started_at DESC);
      CREATE INDEX IF NOT EXISTS idx_status ON query_history(status);
      CREATE INDEX IF NOT EXISTS idx_query_id ON query_history(query_id);
      CREATE INDEX IF NOT EXISTS idx_endpoint_key ON query_history(endpoint_key);
    `);
  }

  /**
   * Insert multiple query logs in a single transaction.
   * Uses INSERT OR REPLACE to handle updates for existing queryIds.
   * @param logs - Array of query logs with required queryId
   */
  async batchInsert(logs: Array<QueryLog & { queryId: string }>): Promise<void> {
    if (!this.db) throw new Error('Database not initialized');
    if (logs.length === 0) return;

    const stmt = this.db.prepare(`
      INSERT OR REPLACE INTO query_history (
        query_id, endpoint_key, endpoint_path, query, parameters,
        started_at, completed_at, duration_ms, status, error_message,
        row_count, cache_status, cache_key, cache_mode, cache_age_ms
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const insertMany = this.db.transaction((logs: Array<QueryLog & { queryId: string; endpointKey?: string; endpointPath?: string }>) => {
      for (const log of logs) {
        stmt.run(
          log.queryId,
          log.endpointKey || null,
          log.endpointPath || null,
          log.query,
          log.parameters ? JSON.stringify(log.parameters) : null,
          log.startTime,
          log.endTime || null,
          log.duration || null,
          log.status,
          log.error?.message || null,
          log.rowCount || null,
          log.cacheStatus || null,
          log.cacheKey || null,
          log.cacheMode || null,
          log.cacheAgeMs || null
        );
      }
    });

    insertMany(logs);
  }

  /**
   * Add a single query log entry.
   * Convenience wrapper around batchInsert.
   * @param log - Query log with required queryId
   */
  async addQuery(log: QueryLog & { queryId: string }): Promise<void> {
    await this.batchInsert([log]);
  }

  /**
   * Map a database row to a QueryHistoryEntry object.
   * Handles JSON parsing for serialized fields.
   * @param row - Raw database row
   * @returns Mapped QueryHistoryEntry
   */
  private mapRow(row: any): QueryHistoryEntry {
    return {
      id: row.id,
      queryId: row.query_id,
      endpointKey: row.endpoint_key,
      endpointPath: row.endpoint_path,
      query: row.query,
      parameters: row.parameters ? JSON.parse(row.parameters) : undefined,
      startTime: row.started_at,
      endTime: row.completed_at,
      duration: row.duration_ms,
      status: row.status,
      error: row.error_message ? new Error(row.error_message) : undefined,
      rowCount: row.row_count,
      cacheStatus: row.cache_status,
      cacheKey: row.cache_key,
      cacheMode: row.cache_mode,
      cacheAgeMs: row.cache_age_ms,
      resultPreview: row.result_preview ? JSON.parse(row.result_preview) : undefined,
      createdAt: row.created_at
    };
  }

  /**
   * Retrieve query history entries with filtering and pagination.
   * @param options - Query options for filtering and pagination
   * @returns Paginated results with total count
   */
  async getQueries(options: GetQueriesOptions): Promise<GetQueriesResult> {
    if (!this.db) throw new Error('Database not initialized');

    const limit = options.limit || 50;
    const offset = options.offset || 0;

    const whereClauses: string[] = [];
    const params: any[] = [];

    if (options.status) {
      whereClauses.push('status = ?');
      params.push(options.status);
    }

    if (options.search) {
      whereClauses.push('query LIKE ?');
      params.push(`%${options.search}%`);
    }

    const whereClause = whereClauses.length > 0
      ? `WHERE ${whereClauses.join(' AND ')}`
      : '';

    // Get total count
    const countStmt = this.db.prepare(
      `SELECT COUNT(*) as count FROM query_history ${whereClause}`
    );
    const { count: total } = countStmt.get(...params) as { count: number };

    // Get paginated results
    const stmt = this.db.prepare(`
      SELECT * FROM query_history
      ${whereClause}
      ORDER BY started_at DESC
      LIMIT ? OFFSET ?
    `);

    const rows = stmt.all(...params, limit, offset) as any[];
    const queries = rows.map(row => this.mapRow(row));

    return { queries, total };
  }

  /**
   * Retrieve a single query by its unique ID.
   * @param queryId - The unique query identifier
   * @returns The query entry or null if not found
   */
  async getQuery(queryId: string): Promise<QueryHistoryEntry | null> {
    if (!this.db) throw new Error('Database not initialized');

    const stmt = this.db.prepare(
      'SELECT * FROM query_history WHERE query_id = ?'
    );
    const row = stmt.get(queryId);

    return row ? this.mapRow(row) : null;
  }

  /**
   * Calculate aggregate cache performance statistics.
   * @returns Cache stats snapshot with hit rates
   */
  async getCacheStats(): Promise<CacheStatsSnapshot> {
    if (!this.db) throw new Error('Database not initialized');

    const stmt = this.db.prepare(`
      SELECT
        COUNT(CASE WHEN cache_status = 'hit' THEN 1 END) as hits,
        COUNT(CASE WHEN cache_status = 'miss' THEN 1 END) as misses,
        COUNT(CASE WHEN cache_status = 'stale-hit' THEN 1 END) as staleHits,
        COUNT(CASE WHEN cache_status = 'revalidate' THEN 1 END) as revalidations
      FROM query_history
      WHERE cache_status IS NOT NULL
    `);

    const stats = stmt.get() as any;
    const total = (stats.hits || 0) + (stats.misses || 0) + (stats.staleHits || 0);
    const hitRate = total > 0 ? ((stats.hits || 0) + (stats.staleHits || 0)) / total : 0;

    return {
      hits: stats.hits || 0,
      misses: stats.misses || 0,
      staleHits: stats.staleHits || 0,
      revalidations: stats.revalidations || 0,
      hitRate
    };
  }

  /**
   * Apply retention policy to remove old entries.
   * Removes entries exceeding maxQueries or older than maxDays.
   * @param policy - Retention policy configuration
   */
  async cleanup(policy: RetentionPolicy): Promise<void> {
    if (!this.db) throw new Error('Database not initialized');

    const cutoffTime = Date.now() - (policy.maxDays * 24 * 60 * 60 * 1000);

    // Delete entries that are:
    // 1. Not in the top maxQueries most recent entries, OR
    // 2. Older than the cutoff time
    this.db.prepare(`
      DELETE FROM query_history
      WHERE id NOT IN (
        SELECT id FROM query_history
        ORDER BY started_at DESC
        LIMIT ?
      )
      OR started_at < ?
    `).run(policy.maxQueries, cutoffTime);
  }

  /**
   * Export all query history to JSON format.
   * @param format - Export format (currently only 'json' supported)
   * @returns JSON string of all query history entries
   */
  async export(format: 'json'): Promise<string> {
    if (!this.db) throw new Error('Database not initialized');

    const stmt = this.db.prepare('SELECT * FROM query_history ORDER BY started_at ASC');
    const rows = stmt.all() as any[];
    const queries = rows.map(row => this.mapRow(row));

    return JSON.stringify(queries, null, 2);
  }

  /**
   * Import query history from JSON format.
   * Merges imported data with existing entries using INSERT OR REPLACE.
   * @param data - JSON string of query history entries
   * @param format - Import format (currently only 'json' supported)
   */
  async import(data: string, format: 'json'): Promise<void> {
    if (!this.db) throw new Error('Database not initialized');

    const queries = JSON.parse(data) as QueryHistoryEntry[];
    const logs = queries.map(q => ({
      queryId: q.queryId,
      query: q.query,
      parameters: q.parameters,
      startTime: q.startTime,
      endTime: q.endTime,
      duration: q.duration,
      status: q.status,
      error: q.error,
      rowCount: q.rowCount,
      cacheStatus: q.cacheStatus,
      cacheKey: q.cacheKey,
      cacheMode: q.cacheMode,
      cacheAgeMs: q.cacheAgeMs,
      endpointKey: q.endpointKey,
      endpointPath: q.endpointPath
    }));

    await this.batchInsert(logs);
  }

  /**
   * Remove all query history entries.
   * Preserves the schema/tables.
   */
  async clear(): Promise<void> {
    if (!this.db) throw new Error('Database not initialized');
    this.db.prepare('DELETE FROM query_history').run();
  }

  /**
   * Close the database connection and release resources.
   * Should be called on application shutdown.
   */
  async close(): Promise<void> {
    this.db?.close();
    this.db = null;
  }
}
