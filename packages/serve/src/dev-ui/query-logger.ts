import type { ServeQueryLogger, ServeQueryEvent } from '../query-logger.js';
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
}

/**
 * Non-blocking query logger for development.
 *
 * Subscribes to the serve-layer {@link ServeQueryLogger} to capture every
 * endpoint execution, regardless of the underlying query backend
 * (ClickHouse, BigQuery, mock data, etc.).
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
  private unsubscribe?: () => void;

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

  constructor(
    private store: QueryHistoryStore,
    options: DevQueryLoggerOptions = {}
  ) {
    this.batchSize = options.batchSize ?? 10;
    this.flushInterval = options.flushInterval ?? 1000;
  }

  /**
   * Initialize the logger and subscribe to a serve-layer query logger.
   *
   * This is backend-agnostic — it captures events from the serve layer,
   * which fires for all endpoint executions regardless of the query backend.
   */
  initialize(serveLogger?: ServeQueryLogger): void {
    if (this.isInitialized) return;

    if (serveLogger) {
      this.unsubscribe = serveLogger.on((event) => {
        this.handleServeEvent(event);
      });
    }

    // Start the flush timer
    this.startFlushTimer();
    this.isInitialized = true;
  }

  /**
   * Convert a ServeQueryEvent into a QueryLog and enqueue it.
   */
  private handleServeEvent(event: ServeQueryEvent): void {
    const log: QueryLog & { queryId: string; endpointKey?: string; endpointPath?: string } = {
      queryId: event.requestId,
      query: `${event.method} ${event.path}`,
      parameters: event.input != null ? [event.input] : undefined,
      startTime: event.startTime,
      endTime: event.endTime,
      duration: event.durationMs,
      status: event.status,
      error: event.error,
      endpointKey: event.endpointKey,
      endpointPath: event.path,
    };

    this.enqueue(log);
  }

  /**
   * Add a query log to the queue (non-blocking).
   * This method returns immediately without awaiting storage.
   */
  private enqueue(log: QueryLog & { queryId: string; endpointKey?: string; endpointPath?: string }): void {
    if (this.isShuttingDown) return;

    this.queue.push(log);
    this.stats.totalLogged++;
    this.stats.queueSize = this.queue.length;

    // Emit event to listeners
    this.emitEvent(log);

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

    // Unsubscribe from serve logger
    this.unsubscribe?.();

    // Clear event listeners
    this.eventListeners.clear();

    // Flush remaining items
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
