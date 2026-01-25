import type { ServerResponse } from 'http';
import type { QueryLogEvent } from '../query-logger.js';

/**
 * Represents a connected SSE client.
 */
interface SSEClient {
  /** Unique identifier for this client connection */
  id: string;
  /** The HTTP response object for streaming events */
  res: ServerResponse;
  /** Last event ID received by client (for reconnection) */
  lastEventId?: string;
  /** Timestamp when client connected */
  connectedAt: number;
}

/**
 * SSE event data structure.
 */
export interface SSEEvent {
  /** Event type (e.g., 'query:started', 'query:completed') */
  type: string;
  /** Event payload */
  data: unknown;
  /** Optional event ID for client reconnection */
  id?: string;
  /** Optional retry interval suggestion in milliseconds */
  retry?: number;
}

/**
 * Server-Sent Events handler for real-time query updates.
 *
 * Features:
 * - Multiple concurrent client connections
 * - Automatic heartbeat to keep connections alive
 * - Client reconnection support via Last-Event-ID
 * - Graceful cleanup on disconnect
 * - Event broadcasting to all connected clients
 */
export class SSEHandler {
  private clients: Map<string, SSEClient> = new Map();
  private heartbeatTimer: NodeJS.Timeout | null = null;
  private eventCounter = 0;

  private readonly heartbeatInterval: number;

  /**
   * Create a new SSE handler.
   * @param heartbeatInterval - Interval between heartbeat messages in ms (default: 30000)
   */
  constructor(heartbeatInterval = 30000) {
    this.heartbeatInterval = heartbeatInterval;
  }

  /**
   * Start the heartbeat timer.
   * Sends periodic comments to keep connections alive.
   */
  startHeartbeat(): void {
    if (this.heartbeatTimer) return;

    this.heartbeatTimer = setInterval(() => {
      this.sendHeartbeat();
    }, this.heartbeatInterval);

    // Don't keep the process alive just for heartbeats
    this.heartbeatTimer.unref?.();
  }

  /**
   * Stop the heartbeat timer.
   */
  stopHeartbeat(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }

  /**
   * Add a new SSE client connection.
   * Sets up the response headers and registers the client.
   *
   * @param res - The HTTP response object
   * @param lastEventId - Optional Last-Event-ID header for reconnection
   * @returns The client ID
   */
  addClient(res: ServerResponse, lastEventId?: string): string {
    const clientId = this.generateClientId();

    // Set SSE headers
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no' // Disable nginx buffering
    });

    // Send initial retry interval
    res.write(`retry: 5000\n\n`);

    // Register client
    const client: SSEClient = {
      id: clientId,
      res,
      lastEventId,
      connectedAt: Date.now()
    };
    this.clients.set(clientId, client);

    // Handle client disconnect
    res.on('close', () => {
      this.removeClient(clientId);
    });

    res.on('error', () => {
      this.removeClient(clientId);
    });

    // Start heartbeat if this is the first client
    if (this.clients.size === 1) {
      this.startHeartbeat();
    }

    // Send connection confirmation
    this.sendToClient(clientId, {
      type: 'connected',
      data: { clientId, connectedAt: client.connectedAt }
    });

    return clientId;
  }

  /**
   * Remove a client connection.
   * @param clientId - The client ID to remove
   */
  removeClient(clientId: string): void {
    const client = this.clients.get(clientId);
    if (client) {
      try {
        client.res.end();
      } catch {
        // Ignore errors when ending response
      }
      this.clients.delete(clientId);
    }

    // Stop heartbeat if no clients remain
    if (this.clients.size === 0) {
      this.stopHeartbeat();
    }
  }

  /**
   * Send an event to a specific client.
   * @param clientId - The target client ID
   * @param event - The event to send
   */
  sendToClient(clientId: string, event: SSEEvent): boolean {
    const client = this.clients.get(clientId);
    if (!client) return false;

    try {
      const eventId = event.id || this.generateEventId();
      const message = this.formatEvent(event, eventId);
      client.res.write(message);
      return true;
    } catch {
      // Client disconnected, remove them
      this.removeClient(clientId);
      return false;
    }
  }

  /**
   * Broadcast an event to all connected clients.
   * @param event - The event to broadcast
   * @returns Number of clients that received the event
   */
  broadcast(event: SSEEvent): number {
    const eventId = event.id || this.generateEventId();
    const message = this.formatEvent(event, eventId);
    let successCount = 0;

    for (const [clientId, client] of this.clients) {
      try {
        client.res.write(message);
        successCount++;
      } catch {
        // Client disconnected, remove them
        this.removeClient(clientId);
      }
    }

    return successCount;
  }

  /**
   * Broadcast a query log event to all clients.
   * Convenience method for DevQueryLogger integration.
   * @param event - The query log event
   */
  broadcastQueryEvent(event: QueryLogEvent): void {
    this.broadcast({
      type: event.type,
      data: event.data
    });
  }

  /**
   * Send heartbeat to all clients.
   * Uses SSE comment syntax to keep connections alive.
   */
  private sendHeartbeat(): void {
    const heartbeat = `:heartbeat ${Date.now()}\n\n`;

    for (const [clientId, client] of this.clients) {
      try {
        client.res.write(heartbeat);
      } catch {
        // Client disconnected, remove them
        this.removeClient(clientId);
      }
    }
  }

  /**
   * Format an event for SSE transmission.
   * @param event - The event to format
   * @param eventId - The event ID
   * @returns Formatted SSE message string
   */
  private formatEvent(event: SSEEvent, eventId: string): string {
    let message = '';

    // Event ID
    message += `id: ${eventId}\n`;

    // Event type
    message += `event: ${event.type}\n`;

    // Retry interval (if specified)
    if (event.retry !== undefined) {
      message += `retry: ${event.retry}\n`;
    }

    // Data (JSON encoded, split by newlines)
    const dataStr = JSON.stringify(event.data);
    message += `data: ${dataStr}\n`;

    // End of event
    message += '\n';

    return message;
  }

  /**
   * Generate a unique client ID.
   */
  private generateClientId(): string {
    return `client-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
  }

  /**
   * Generate a unique event ID.
   */
  private generateEventId(): string {
    return `evt-${++this.eventCounter}`;
  }

  /**
   * Get the number of connected clients.
   */
  get clientCount(): number {
    return this.clients.size;
  }

  /**
   * Get information about connected clients.
   */
  getClients(): Array<{ id: string; connectedAt: number }> {
    return Array.from(this.clients.values()).map(client => ({
      id: client.id,
      connectedAt: client.connectedAt
    }));
  }

  /**
   * Shutdown the SSE handler.
   * Disconnects all clients and stops the heartbeat.
   */
  shutdown(): void {
    this.stopHeartbeat();

    // Send close event and disconnect all clients
    for (const clientId of this.clients.keys()) {
      try {
        this.sendToClient(clientId, {
          type: 'shutdown',
          data: { reason: 'Server shutting down' }
        });
      } catch {
        // Ignore errors
      }
      this.removeClient(clientId);
    }
  }
}
