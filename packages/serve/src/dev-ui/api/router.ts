import type { IncomingMessage, ServerResponse } from 'http';
import type { QueryHistoryStore } from '../storage/types.js';
import type { DevQueryLogger } from '../query-logger.js';
import { SSEHandler } from './sse-handler.js';
import * as endpoints from './endpoints.js';

/**
 * Options for the dev API router.
 */
export interface RouterOptions {
  /** Query history store */
  store: QueryHistoryStore;
  /** Optional cache manager for cache operations */
  cacheManager?: {
    invalidate(key: string): Promise<void>;
    clear(): Promise<void>;
  };
  /** Optional query logger for stats */
  logger?: DevQueryLogger;
  /** Optional API instance for available queries */
  api?: {
    endpoints?: Record<string, {
      path?: string;
      method?: string;
      description?: string;
      tags?: string[];
      inputSchema?: unknown;
    }>;
  };
}

/**
 * Available dev API routes for documentation.
 */
const AVAILABLE_ROUTES = [
  'GET /__dev/events - SSE connection for real-time updates',
  'GET /__dev/queries - List query history',
  'GET /__dev/queries/:id - Get single query',
  'GET /__dev/queries/available - List available API endpoints',
  'DELETE /__dev/queries - Clear query history',
  'GET /__dev/cache/stats - Get cache statistics',
  'POST /__dev/cache/invalidate - Invalidate cache keys',
  'POST /__dev/cache/clear - Clear all cache',
  'GET /__dev/logger/stats - Get logger statistics',
  'GET /__dev/export - Export query history',
  'POST /__dev/import - Import query history'
];

/**
 * Dev API router with SSE support.
 *
 * Handles all /__dev/* routes for the development UI.
 */
export class DevAPIRouter {
  private sseHandler: SSEHandler;
  private options: RouterOptions;

  constructor(options: RouterOptions) {
    this.options = options;
    this.sseHandler = new SSEHandler(30000);
  }

  /**
   * Handle CORS preflight and set CORS headers.
   * @returns true if the request was handled (OPTIONS request)
   */
  private handleCORS(req: IncomingMessage, res: ServerResponse): boolean {
    // Set CORS headers for all /__dev/ requests
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Last-Event-ID');

    // Handle preflight
    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return true;
    }

    return false;
  }

  /**
   * Send 404 response with available routes.
   */
  private send404(res: ServerResponse, path: string): void {
    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      error: 'Not found',
      path,
      availableRoutes: AVAILABLE_ROUTES
    }));
  }

  /**
   * Create endpoint context for handlers.
   */
  private createContext(req: IncomingMessage, res: ServerResponse): endpoints.EndpointContext {
    return {
      store: this.options.store,
      cacheManager: this.options.cacheManager,
      logger: this.options.logger,
      api: this.options.api,
      sseHandler: this.sseHandler,
      req,
      res
    };
  }

  /**
   * Handle incoming dev API request.
   * @returns true if the request was handled, false otherwise
   */
  async handleRequest(req: IncomingMessage, res: ServerResponse): Promise<boolean> {
    const url = req.url || '';
    const method = req.method || 'GET';

    // Only handle /__dev/ routes
    if (!url.startsWith('/__dev/')) {
      return false;
    }

    // Handle CORS preflight
    if (this.handleCORS(req, res)) {
      return true;
    }

    const ctx = this.createContext(req, res);

    // Parse URL path (without query string)
    const path = url.split('?')[0];

    // Route: SSE Events
    if (path === '/__dev/events' && method === 'GET') {
      const lastEventId = req.headers['last-event-id'] as string | undefined;
      this.sseHandler.addClient(res, lastEventId);
      return true;
    }

    // Route: Available queries (must come before /__dev/queries/:id)
    if (path === '/__dev/queries/available' && method === 'GET') {
      await endpoints.getAvailableQueries(ctx);
      return true;
    }

    // Route: Single query by ID
    if (path.startsWith('/__dev/queries/') && method === 'GET') {
      const queryId = path.slice('/__dev/queries/'.length);
      if (queryId && queryId !== 'available') {
        await endpoints.getQuery(ctx, queryId);
        return true;
      }
    }

    // Route: List queries
    if (path === '/__dev/queries' && method === 'GET') {
      await endpoints.getQueries(ctx);
      return true;
    }

    // Route: Clear query history
    if (path === '/__dev/queries' && method === 'DELETE') {
      await endpoints.clearHistory(ctx);
      return true;
    }

    // Route: Cache stats
    if (path === '/__dev/cache/stats' && method === 'GET') {
      await endpoints.getCacheStats(ctx);
      return true;
    }

    // Route: Invalidate cache
    if (path === '/__dev/cache/invalidate' && method === 'POST') {
      await endpoints.invalidateCache(ctx);
      return true;
    }

    // Route: Clear cache
    if (path === '/__dev/cache/clear' && method === 'POST') {
      await endpoints.clearCache(ctx);
      return true;
    }

    // Route: Logger stats
    if (path === '/__dev/logger/stats' && method === 'GET') {
      await endpoints.getLoggerStats(ctx);
      return true;
    }

    // Route: Export history
    if (path === '/__dev/export' && method === 'GET') {
      await endpoints.exportHistory(ctx);
      return true;
    }

    // Route: Import history
    if (path === '/__dev/import' && method === 'POST') {
      await endpoints.importHistory(ctx);
      return true;
    }

    // 404 for unmatched /__dev/* routes
    this.send404(res, path);
    return true;
  }

  /**
   * Get the SSE handler for broadcasting events.
   */
  getSSEHandler(): SSEHandler {
    return this.sseHandler;
  }

  /**
   * Get count of connected SSE clients.
   */
  getClientCount(): number {
    return this.sseHandler.clientCount;
  }

  /**
   * Shutdown the router and close all connections.
   */
  shutdown(): void {
    this.sseHandler.shutdown();
  }
}

/**
 * Create a dev API router.
 *
 * @example
 * ```typescript
 * const router = createDevRouter({
 *   store: await createStore(),
 *   logger: queryLogger,
 *   api: serveApi
 * });
 *
 * // In request handler:
 * if (await router.handleRequest(req, res)) {
 *   return; // Request was handled
 * }
 * ```
 */
export function createDevRouter(options: RouterOptions): DevAPIRouter {
  return new DevAPIRouter(options);
}
