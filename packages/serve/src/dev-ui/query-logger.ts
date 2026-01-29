import { logger as clickhouseLogger } from '@hypequery/clickhouse';
import type { QueryHistoryStore, QueryLog } from './storage/index.js';

/**
 * Statistics for the query logger.
 */
export interface LoggerStats {
  /** Total queries logged */
  totalLogged: number;
  /** Queries successfully persisted to storage */
  persisted: number;
  /** Queries that failed to persist */
  failed: number;
  /** Current queue size */
  queueSize: number;
  /** Number of batch flushes performed */
  flushCount: number;
  /** Average batch size */
  avgBatchSize: number;
}

/**
 * Event types emitted by the query logger.
 */
export type QueryLogEvent =
  | { type: 'query:started'; data: QueryLog & { queryId: string } }
  | { type: 'query:completed'; data: QueryLog & { queryId: string } }
  | { type: 'query:error'; data: QueryLog & { queryId: string } };

/**
 * Callback for query log events.
 */
export type QueryLogEventCallback = (event: QueryLogEvent) => void;

/**
 * Options for DevQueryLogger.
 */
export interface DevQueryLoggerOptions {
  /** Batch size before flushing to storage (default: 10) */
  batchSize?: number;
  /** Maximum time to wait before flushing (default: 1000ms) */
  flushInterval?: number;
  /** Enable endpoint metadata tracking (default: true) */
  trackEndpoints?: boolean;
}

/**
 * Non-blocking query logger for development.
 *
 * Provides:
 * - Queue-based non-blocking logging
 * - Batch processing for efficient storage
 * - SSE event broadcasting
 * - Performance metrics tracking
 * - Graceful shutdown with queue flushing
 */
export class DevQueryLogger {
  private queue: Array<QueryLog & { queryId: string; endpointKey?: string; endpointPath?: string }> = [];
  private flushTimer: NodeJS.Timeout | null = null;
  private isShuttingDown = false;
  private eventListeners: Set<QueryLogEventCallback> = new Set();
  private isInitialized = false;

  private stats: LoggerStats = {
    totalLogged: 0,
    persisted: 0,
    failed: 0,
    queueSize: 0,
    flushCount: 0,
    avgBatchSize: 0
  };

  private readonly batchSize: number;
  private readonly flushInterval: number;
  private readonly trackEndpoints: boolean;

  // Track current endpoint context for associating queries
  private currentEndpointKey?: string;
  private currentEndpointPath?: string;

  constructor(
    private store: QueryHistoryStore,
    options: DevQueryLoggerOptions = {}
  ) {
    this.batchSize = options.batchSize ?? 10;
    this.flushInterval = options.flushInterval ?? 1000;
    this.trackEndpoints = options.trackEndpoints ?? true;
  }

  /**
   * Initialize the logger and subscribe to clickhouse query logs.
   * Configures the clickhouse logger to forward query logs to this logger.
   */
  initialize(): void {
    if (this.isInitialized) return;

    // Configure clickhouse logger to call our enqueue method
    clickhouseLogger.configure({
      onQueryLog: (log) => {
        this.enqueue(log);
      }
    });

    // Start the flush timer
    this.startFlushTimer();
    this.isInitialized = true;
  }

  /**
   * Set the current endpoint context for query association.
   * Call this before executing queries in an endpoint handler.
   */
  setEndpointContext(key?: string, path?: string): void {
    if (this.trackEndpoints) {
      this.currentEndpointKey = key;
      this.currentEndpointPath = path;
    }
  }

  /**
   * Clear the current endpoint context.
   * Call this after endpoint execution completes.
   */
  clearEndpointContext(): void {
    this.currentEndpointKey = undefined;
    this.currentEndpointPath = undefined;
  }

  /**
   * Add a query log to the queue (non-blocking).
   * This method returns immediately without awaiting storage.
   */
  private enqueue(log: QueryLog): void {
    if (this.isShuttingDown) return;

    // Generate queryId if not present
    const queryId = log.queryId || this.generateQueryId();

    const entry = {
      ...log,
      queryId,
      endpointKey: this.currentEndpointKey,
      endpointPath: this.currentEndpointPath
    };

    this.queue.push(entry);
    this.stats.totalLogged++;
    this.stats.queueSize = this.queue.length;

    // Emit event to listeners
    this.emitEvent(entry);

    // Flush if batch size reached
    if (this.queue.length >= this.batchSize) {
      this.flush();
    }
  }

  /**
   * Emit appropriate event based on query status.
   */
  private emitEvent(log: QueryLog & { queryId: string }): void {
    let event: QueryLogEvent;

    switch (log.status) {
      case 'started':
        event = { type: 'query:started', data: log };
        break;
      case 'completed':
        event = { type: 'query:completed', data: log };
        break;
      case 'error':
        event = { type: 'query:error', data: log };
        break;
      default:
        return;
    }

    for (const listener of this.eventListeners) {
      try {
        listener(event);
      } catch {
        // Ignore listener errors
      }
    }
  }

  /**
   * Subscribe to query log events.
   * @returns Unsubscribe function
   */
  onEvent(callback: QueryLogEventCallback): () => void {
    this.eventListeners.add(callback);
    return () => {
      this.eventListeners.delete(callback);
    };
  }

  /**
   * Flush the queue to storage (non-blocking).
   * Returns immediately, persistence happens in background.
   */
  private flush(): void {
    if (this.queue.length === 0) return;

    // Take current queue and reset
    const toFlush = this.queue;
    this.queue = [];
    this.stats.queueSize = 0;

    // Update stats
    this.stats.flushCount++;
    this.stats.avgBatchSize =
      (this.stats.avgBatchSize * (this.stats.flushCount - 1) + toFlush.length) /
      this.stats.flushCount;

    // Persist in background (fire and forget)
    this.persistBatch(toFlush);
  }

  /**
   * Persist a batch of logs to storage.
   */
  private async persistBatch(logs: Array<QueryLog & { queryId: string }>): Promise<void> {
    try {
      await this.store.batchInsert(logs);
      this.stats.persisted += logs.length;
    } catch (error) {
      this.stats.failed += logs.length;
      console.error('[hypequery] Failed to persist query logs:', error);
    }
  }

  /**
   * Start the periodic flush timer.
   */
  private startFlushTimer(): void {
    if (this.flushTimer) return;

    this.flushTimer = setInterval(() => {
      this.flush();
    }, this.flushInterval);

    // Don't keep the process alive just for flushing
    this.flushTimer.unref?.();
  }

  /**
   * Stop the periodic flush timer.
   */
  private stopFlushTimer(): void {
    if (this.flushTimer) {
      clearInterval(this.flushTimer);
      this.flushTimer = null;
    }
  }

  /**
   * Generate a unique query ID.
   */
  private generateQueryId(): string {
    return `q-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
  }

  /**
   * Get current logger statistics.
   */
  getStats(): LoggerStats {
    return { ...this.stats, queueSize: this.queue.length };
  }

  /**
   * Gracefully shutdown the logger.
   * Flushes remaining queue and clears event listeners.
   */
  async shutdown(): Promise<void> {
    this.isShuttingDown = true;
    this.isInitialized = false;

    // Stop the timer
    this.stopFlushTimer();

    // Remove our onQueryLog handler by configuring with undefined
    clickhouseLogger.configure({
      onQueryLog: undefined
    });

    // Clear event listeners
    this.eventListeners.clear();

    // Flush remaining items synchronously
    if (this.queue.length > 0) {
      const toFlush = this.queue;
      this.queue = [];

      try {
        await this.store.batchInsert(toFlush);
        this.stats.persisted += toFlush.length;
      } catch (error) {
        this.stats.failed += toFlush.length;
        console.error('[hypequery] Failed to flush queue on shutdown:', error);
      }
    }
  }

  /**
   * Manually add a query log entry.
   * Useful for logging queries not captured by the automatic hook.
   */
  log(log: QueryLog & { queryId?: string }): void {
    const queryId = log.queryId || this.generateQueryId();
    this.enqueue({ ...log, queryId });
  }
}
