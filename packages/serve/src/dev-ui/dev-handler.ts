import type { IncomingMessage, ServerResponse } from 'http';
import type { QueryHistoryStore } from './storage/types.js';
import type { DevQueryLogger } from './query-logger.js';
import { DevAPIRouter, type RouterOptions } from './api/router.js';
import { getDevUIAssets } from './assets.js';

/**
 * Options for creating the dev handler.
 */
export interface DevHandlerOptions {
  /** Query history store */
  store: QueryHistoryStore;
  /** Query logger for stats */
  logger?: DevQueryLogger;
  /** Cache manager for cache operations */
  cacheManager?: RouterOptions['cacheManager'];
  /** API instance with endpoints and execute function */
  api?: RouterOptions['api'];
  /** Base path for dev UI (default: /__dev) */
  basePath?: string;
}

/**
 * Dev handler that serves the React UI and routes API requests.
 */
export class DevHandler {
  private router: DevAPIRouter;
  private basePath: string;
  private assets: ReturnType<typeof getDevUIAssets>;

  constructor(options: DevHandlerOptions) {
    this.basePath = options.basePath ?? '/__dev';
    this.assets = getDevUIAssets();

    this.router = new DevAPIRouter({
      store: options.store,
      logger: options.logger,
      cacheManager: options.cacheManager,
      api: options.api
    });
  }

  /**
   * Handle an incoming HTTP request.
   * @returns true if the request was handled, false otherwise
   */
  async handleRequest(req: IncomingMessage, res: ServerResponse): Promise<boolean> {
    const url = req.url || '';
    const path = url.split('?')[0];

    // Only handle requests under basePath
    if (!path.startsWith(this.basePath)) {
      return false;
    }

    // Route: Serve React UI at /__dev or /__dev/
    if (path === this.basePath || path === `${this.basePath}/`) {
      this.serveHTML(res);
      return true;
    }

    // Route: Serve static assets
    if (path.startsWith(`${this.basePath}/assets/`)) {
      const assetPath = path.slice(`${this.basePath}/assets/`.length);
      return this.serveAsset(res, assetPath);
    }

    // Route: API endpoints (/__dev/*)
    // The router handles /__dev/events, /__dev/queries, etc.
    return this.router.handleRequest(req, res);
  }

  /**
   * Serve the main HTML page.
   */
  private serveHTML(res: ServerResponse): void {
    res.writeHead(200, {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'no-cache'
    });
    res.end(this.assets.html);
  }

  /**
   * Serve a static asset (JS, CSS).
   */
  private serveAsset(res: ServerResponse, assetPath: string): boolean {
    // Serve JavaScript
    if (assetPath.endsWith('.js')) {
      const js = this.assets.js[assetPath];
      if (js) {
        res.writeHead(200, {
          'Content-Type': 'application/javascript; charset=utf-8',
          'Cache-Control': 'public, max-age=31536000, immutable'
        });
        res.end(js);
        return true;
      }
    }

    // Serve CSS
    if (assetPath.endsWith('.css')) {
      const css = this.assets.css[assetPath];
      if (css) {
        res.writeHead(200, {
          'Content-Type': 'text/css; charset=utf-8',
          'Cache-Control': 'public, max-age=31536000, immutable'
        });
        res.end(css);
        return true;
      }
    }

    // Asset not found
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('Not found');
    return true;
  }

  /**
   * Get the API router for direct access.
   */
  getRouter(): DevAPIRouter {
    return this.router;
  }

  /**
   * Get count of connected SSE clients.
   */
  getClientCount(): number {
    return this.router.getClientCount();
  }

  /**
   * Shutdown the handler and close all connections.
   */
  shutdown(): void {
    this.router.shutdown();
  }
}

/**
 * Create a dev handler.
 *
 * @example
 * ```typescript
 * const devHandler = createDevHandler({
 *   store: await createStore(),
 *   logger: queryLogger,
 *   api: {
 *     endpoints: serveApi.queries,
 *     execute: (key, opts) => serveApi.execute(key, opts)
 *   }
 * });
 *
 * // In request handler:
 * if (await devHandler.handleRequest(req, res)) {
 *   return; // Request was handled
 * }
 * // Continue with normal request handling
 * ```
 */
export function createDevHandler(options: DevHandlerOptions): DevHandler {
  return new DevHandler(options);
}
