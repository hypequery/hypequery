import type { SSEEvent, SSEEventType, QueryEventData } from './types';

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
  private lastEventId: string | null = null;

  private readonly url: string;
  private readonly reconnectDelay: number;
  private readonly maxReconnectAttempts: number;
  private readonly onStateChange?: (state: ConnectionState) => void;

  constructor(options: SSEConnectionOptions = {}) {
    this.url = options.url ?? '/__dev/events';
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

    // Add last event ID to URL for reconnection
    let url = this.url;
    if (this.lastEventId) {
      const separator = url.includes('?') ? '&' : '?';
      url += `${separator}lastEventId=${encodeURIComponent(this.lastEventId)}`;
    }

    this.eventSource = new EventSource(url);

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
      'query:start',
      'query:complete',
      'query:error',
      'cache:hit',
      'cache:invalidate',
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
    const unsubStart = this.on('query:start', handler);
    const unsubComplete = this.on('query:complete', handler);
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
      if (event.lastEventId) {
        this.lastEventId = event.lastEventId;
      }

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
      if (event.lastEventId) {
        this.lastEventId = event.lastEventId;
      }

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
    defaultConnection = new SSEConnection();
  }
  return defaultConnection;
}
