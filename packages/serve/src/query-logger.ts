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

/**
 * Format a query event as a human-readable log line.
 * Returns null for 'started' events (only logs completions).
 */
export function formatQueryEvent(event: ServeQueryEvent): string | null {
  if (event.status === 'started') return null;

  const status = event.status === 'completed' ? '✓' : '✗';
  const duration = event.durationMs != null ? `${event.durationMs}ms` : '?';
  const code = event.responseStatus ?? (event.status === 'error' ? 500 : 200);

  let line = `  ${status} ${event.method} ${event.path} → ${code} (${duration})`;
  if (event.status === 'error' && event.error) {
    line += ` — ${event.error.message}`;
  }
  return line;
}

/**
 * Format a query event as a structured JSON string for log aggregators.
 * Returns null for 'started' events (only logs completions).
 */
export function formatQueryEventJSON(event: ServeQueryEvent): string | null {
  if (event.status === 'started') return null;

  return JSON.stringify({
    level: event.status === 'error' ? 'error' : 'info',
    msg: `${event.method} ${event.path}`,
    requestId: event.requestId,
    endpoint: event.endpointKey,
    path: event.path,
    method: event.method,
    status: event.responseStatus ?? (event.status === 'error' ? 500 : 200),
    durationMs: event.durationMs,
    ...(event.status === 'error' && event.error
      ? { error: event.error.message }
      : {}),
    timestamp: new Date(event.endTime ?? event.startTime).toISOString(),
  });
}
