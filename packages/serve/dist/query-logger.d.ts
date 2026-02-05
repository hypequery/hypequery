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
export declare class ServeQueryLogger {
    private listeners;
    /**
     * Subscribe to query events.
     * @returns Unsubscribe function.
     */
    on(callback: ServeQueryEventCallback): () => void;
    /**
     * Emit a query event to all listeners.
     */
    emit(event: ServeQueryEvent): void;
    /**
     * Number of active listeners.
     */
    get listenerCount(): number;
    /**
     * Remove all listeners.
     */
    removeAll(): void;
}
/**
 * Format a query event as a human-readable log line.
 * Returns null for 'started' events (only logs completions).
 */
export declare function formatQueryEvent(event: ServeQueryEvent): string | null;
/**
 * Format a query event as a structured JSON string for log aggregators.
 * Returns null for 'started' events (only logs completions).
 */
export declare function formatQueryEventJSON(event: ServeQueryEvent): string | null;
//# sourceMappingURL=query-logger.d.ts.map