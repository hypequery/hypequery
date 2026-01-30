/**
 * Backend-agnostic query event logger for the serve layer.
 *
 * Fires for every endpoint execution regardless of the underlying
 * query backend (ClickHouse, BigQuery, mock data, etc.).
 */

/**
 * Event emitted by the serve-layer query logger.
 */
export interface ServeQueryEvent {
  requestId: string;
  endpointKey: string;
  path: string;
  method: string;
  status: 'started' | 'completed' | 'error';
  startTime: number;
  endTime?: number;
  durationMs?: number;
  input?: unknown;
  responseStatus?: number;
  error?: Error;
  result?: unknown;
}

/**
 * Callback for serve query events.
 */
export type ServeQueryEventCallback = (event: ServeQueryEvent) => void;

/**
 * Serve-layer query event emitter.
 *
 * Created per `defineServe()` call — not a singleton.
 * Emits events at the request lifecycle level so that dev tools,
 * logging, and analytics work with any query backend.
 */
export class ServeQueryLogger {
  private listeners = new Set<ServeQueryEventCallback>();

  /**
   * Subscribe to query events.
   * @returns Unsubscribe function.
   */
  on(callback: ServeQueryEventCallback): () => void {
    this.listeners.add(callback);
    return () => {
      this.listeners.delete(callback);
    };
  }

  /**
   * Emit a query event to all listeners.
   */
  emit(event: ServeQueryEvent): void {
    for (const listener of this.listeners) {
      try {
        listener(event);
      } catch {
        // Ignore listener errors
      }
    }
  }

  /**
   * Number of active listeners.
   */
  get listenerCount(): number {
    return this.listeners.size;
  }

  /**
   * Remove all listeners.
   */
  removeAll(): void {
    this.listeners.clear();
  }
}
