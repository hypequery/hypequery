import type { SSEEvent, SSEEventType, QueryEventData } from './types';
import { gatewayEventsUrl } from './api-client';

/**
 * SSE connection state.
 */
export type ConnectionState = 'connecting' | 'connected' | 'disconnected' | 'error';

/**
 * Event handler type.
 */
export type SSEEventHandler<T = unknown> = (event: SSEEvent<T>) => void;

/**
 * SSE connection options.
 */
export interface SSEConnectionOptions {
  /** URL for the SSE endpoint */
  url?: string;
  /** Reconnect delay in ms */
  reconnectDelay?: number;
  /** Max reconnect attempts */
  maxReconnectAttempts?: number;
  /** Handler for connection state changes */
  onStateChange?: (state: ConnectionState) => void;
}

/**
 * SSE connection manager for real-time query updates.
 */
export class SSEConnection {
  private eventSource: EventSource | null = null;
  private handlers: Map<SSEEventType | '*', Set<SSEEventHandler>> = new Map();
  private state: ConnectionState = 'disconnected';
  private reconnectAttempts = 0;
  private reconnectTimeout: ReturnType<typeof setTimeout> | null = null;

  private stateListeners: Set<(state: ConnectionState) => void> = new Set();

  private readonly url: string;
  private readonly reconnectDelay: number;
  private readonly maxReconnectAttempts: number;
  private readonly onStateChange?: (state: ConnectionState) => void;

  constructor(options: SSEConnectionOptions = {}) {
    this.url = options.url ?? gatewayEventsUrl();
    this.reconnectDelay = options.reconnectDelay ?? 1000;
    this.maxReconnectAttempts = options.maxReconnectAttempts ?? 10;
    this.onStateChange = options.onStateChange;
  }

  /**
   * Get current connection state.
   */
  getState(): ConnectionState {
    return this.state;
  }

  /**
   * Connect to the SSE endpoint.
   */
  connect(): void {
    if (this.eventSource) {
      return;
    }

    this.setState('connecting');

    // No Last-Event-ID replay in contract v0 — clients refetch history on
    // reconnect, so the endpoint is used as-is.
    this.eventSource = new EventSource(this.url);

    this.eventSource.onopen = () => {
      this.setState('connected');
      this.reconnectAttempts = 0;
    };

    this.eventSource.onerror = () => {
      this.handleDisconnect();
    };

    this.eventSource.onmessage = (event) => {
      this.handleMessage(event);
    };

    // Add specific event listeners for typed events
    const eventTypes: SSEEventType[] = [
      'query:started',
      'query:completed',
      'query:error',
      'cache:updated',
      'connected',
      'heartbeat',
    ];

    for (const type of eventTypes) {
      this.eventSource.addEventListener(type, (event) => {
        this.handleTypedEvent(type, event as MessageEvent);
      });
    }
  }

  /**
   * Disconnect from the SSE endpoint.
   */
  disconnect(): void {
    if (this.reconnectTimeout) {
      clearTimeout(this.reconnectTimeout);
      this.reconnectTimeout = null;
    }

    if (this.eventSource) {
      this.eventSource.close();
      this.eventSource = null;
    }

    this.setState('disconnected');
    this.reconnectAttempts = 0;
  }

  /**
   * Subscribe to events.
   */
  on<T = unknown>(type: SSEEventType | '*', handler: SSEEventHandler<T>): () => void {
    if (!this.handlers.has(type)) {
      this.handlers.set(type, new Set());
    }
    this.handlers.get(type)!.add(handler as SSEEventHandler);

    return () => {
      this.handlers.get(type)?.delete(handler as SSEEventHandler);
    };
  }

  /**
   * Subscribe to query events specifically.
   */
  onQuery(handler: SSEEventHandler<QueryEventData>): () => void {
    const unsubStart = this.on('query:started', handler);
    const unsubComplete = this.on('query:completed', handler);
    const unsubError = this.on('query:error', handler);

    return () => {
      unsubStart();
      unsubComplete();
      unsubError();
    };
  }

  /**
   * Handle connection state change.
   */
  private setState(state: ConnectionState): void {
    this.state = state;
    this.onStateChange?.(state);
    for (const listener of this.stateListeners) listener(state);
  }

  /**
   * Subscribe to connection-state changes. Returns an unsubscribe function.
   * Lets consumers react to state without polling.
   */
  onState(listener: (state: ConnectionState) => void): () => void {
    this.stateListeners.add(listener);
    return () => {
      this.stateListeners.delete(listener);
    };
  }

  /**
   * Handle disconnection and attempt reconnect.
   */
  private handleDisconnect(): void {
    if (this.eventSource) {
      this.eventSource.close();
      this.eventSource = null;
    }

    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      this.setState('error');
      return;
    }

    this.setState('disconnected');
    this.reconnectAttempts++;

    // Exponential backoff
    const delay = this.reconnectDelay * Math.pow(2, this.reconnectAttempts - 1);

    this.reconnectTimeout = setTimeout(() => {
      this.connect();
    }, delay);
  }

  /**
   * Handle generic message event.
   */
  private handleMessage(event: MessageEvent): void {
    try {
      const data = JSON.parse(event.data);

      const sseEvent: SSEEvent = {
        type: data.type ?? 'message',
        data: data.data ?? data,
        timestamp: data.timestamp ?? Date.now(),
        id: event.lastEventId,
      };

      this.emit(sseEvent);
    } catch {
      // Ignore parse errors for non-JSON messages
    }
  }

  /**
   * Handle typed event.
   */
  private handleTypedEvent(type: SSEEventType, event: MessageEvent): void {
    try {
      let data: unknown;
      try {
        data = JSON.parse(event.data);
      } catch {
        data = event.data;
      }

      const sseEvent: SSEEvent = {
        type,
        data,
        timestamp: Date.now(),
        id: event.lastEventId,
      };

      this.emit(sseEvent);
    } catch {
      // Ignore errors
    }
  }

  /**
   * Emit event to handlers.
   */
  private emit(event: SSEEvent): void {
    // Call type-specific handlers
    const handlers = this.handlers.get(event.type);
    if (handlers) {
      for (const handler of handlers) {
        try {
          handler(event);
        } catch (error) {
          console.error('SSE handler error:', error);
        }
      }
    }

    // Call wildcard handlers
    const wildcardHandlers = this.handlers.get('*');
    if (wildcardHandlers) {
      for (const handler of wildcardHandlers) {
        try {
          handler(event);
        } catch (error) {
          console.error('SSE handler error:', error);
        }
      }
    }
  }
}

/**
 * Create an SSE connection with options.
 */
export function createSSEConnection(options?: SSEConnectionOptions): SSEConnection {
  return new SSEConnection(options);
}

/**
 * Default SSE connection singleton.
 */
let defaultConnection: SSEConnection | null = null;

/**
 * Get or create the default SSE connection.
 */
export function getSSEConnection(): SSEConnection {
  if (!defaultConnection) {
    // Resolve the URL through the configured gateway base so embedders that
    // call setGatewayBaseUrl() (e.g. Cloud) get a matching event stream, not
    // the same-origin default. setGatewayBaseUrl is a set-once-at-boot API,
    // so resolving at first use is safe.
    defaultConnection = new SSEConnection({ url: gatewayEventsUrl() });
  }
  return defaultConnection;
}
