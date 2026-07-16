import type { IncomingMessage, ServerResponse } from 'http';
import type { QueryHistoryStore } from '../storage/types.js';
import type { DevQueryLogger } from '../query-logger.js';
import type { CacheObservability, DevIntegrationApi, GatewayCapability } from '../types.js';
import { SSEHandler } from './sse-handler.js';
import type { EndpointContext } from './types.js';
import { getMeta } from './meta-endpoints.js';
import { getRegistry } from './registry-endpoints.js';
import { execute } from './execute-endpoints.js';
import { getQueries, getQuery } from './query-endpoints.js';
import { clearHistory, exportHistory, importHistory } from './history-endpoints.js';
import { getLoggerStats } from './logger-endpoints.js';
import { getCacheStats, clearCache } from './cache-endpoints.js';

/**
 * Options for the dev API router.
 */
export interface RouterOptions {
  /** Query history store */
  store: QueryHistoryStore;
  /** Per-layer cache stats/clear from serve's DevIntegrationApi. */
  cacheObservability?: CacheObservability;
  /** Optional query logger for stats */
  logger?: DevQueryLogger;
  /** The serve API the gateway drives. */
  api?: DevIntegrationApi;
  /** Capabilities advertised via /meta. */
  capabilities: GatewayCapability[];
  /** Project name surfaced in /meta. */
  projectName?: string;
  /**
   * Cross-origin allowlist. Empty by default — the studio is served
   * same-origin, so no CORS headers are emitted and the wildcard `*` is
   * never used. Add explicit origins only when a remote UI must connect.
   */
  allowedOrigins?: string[];
}

/**
 * Dev API router with SSE support. Handles all /__dev/* API routes.
 * Implements gateway contract v0 (see plans/gateway-contract.md).
 */
export class DevAPIRouter {
  private sseHandler: SSEHandler;
  private options: RouterOptions;
  private allowedOrigins: Set<string>;

  constructor(options: RouterOptions) {
    this.options = options;
    this.sseHandler = new SSEHandler(30000);
    this.allowedOrigins = new Set(options.allowedOrigins ?? []);
  }

  /**
   * Apply CORS headers only for explicitly allowlisted origins. Same-origin
   * requests need no headers; the wildcard `*` is never emitted.
   * @returns true if the request was fully handled (OPTIONS preflight)
   */
  private handleCORS(req: IncomingMessage, res: ServerResponse): boolean {
    const origin = req.headers.origin;
    if (origin && this.allowedOrigins.has(origin)) {
      res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('Vary', 'Origin');
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, Last-Event-ID');
    }

    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return true;
    }
    return false;
  }

  private send404(res: ServerResponse, path: string): void {
    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Not found', path }));
  }

  private createContext(req: IncomingMessage, res: ServerResponse): EndpointContext {
    return {
      store: this.options.store,
      cacheObservability: this.options.cacheObservability,
      logger: this.options.logger,
      api: this.options.api,
      capabilities: this.options.capabilities,
      projectName: this.options.projectName,
      sseHandler: this.sseHandler,
      req,
      res
    };
  }

  /**
   * Handle an incoming /__dev/* API request.
   * @returns true if the request was handled, false otherwise
   */
  async handleRequest(req: IncomingMessage, res: ServerResponse): Promise<boolean> {
    const url = req.url || '';
    const method = req.method || 'GET';

    if (!url.startsWith('/__dev/')) return false;
    if (this.handleCORS(req, res)) return true;

    const ctx = this.createContext(req, res);
    const path = url.split('?')[0];

    // Discovery
    if (path === '/__dev/meta' && method === 'GET') {
      await getMeta(ctx);
      return true;
    }

    // Registry
    if (path === '/__dev/registry' && method === 'GET') {
      await getRegistry(ctx);
      return true;
    }

    // Execute
    if (path === '/__dev/execute' && method === 'POST') {
      await execute(ctx);
      return true;
    }

    // SSE — no Last-Event-ID replay in v0 (clients refetch history on reconnect)
    if (path === '/__dev/events' && method === 'GET') {
      this.sseHandler.addClient(res);
      return true;
    }

    // History (renamed from donor /queries)
    if (path === '/__dev/history/export' && method === 'GET') {
      await exportHistory(ctx);
      return true;
    }
    if (path === '/__dev/history/import' && method === 'POST') {
      await importHistory(ctx);
      return true;
    }
    if (path.startsWith('/__dev/history/') && method === 'GET') {
      const queryId = path.slice('/__dev/history/'.length);
      if (queryId) {
        await getQuery(ctx, queryId);
        return true;
      }
    }
    if (path === '/__dev/history' && method === 'GET') {
      await getQueries(ctx);
      return true;
    }
    if (path === '/__dev/history' && method === 'DELETE') {
      await clearHistory(ctx);
      return true;
    }

    // Logger stats
    if (path === '/__dev/logger/stats' && method === 'GET') {
      await getLoggerStats(ctx);
      return true;
    }

    // Cache (capability-gated)
    if (path === '/__dev/cache' && method === 'GET') {
      await getCacheStats(ctx);
      return true;
    }
    if (path === '/__dev/cache/clear' && method === 'POST') {
      await clearCache(ctx);
      return true;
    }

    this.send404(res, path);
    return true;
  }

  getSSEHandler(): SSEHandler {
    return this.sseHandler;
  }

  getClientCount(): number {
    return this.sseHandler.clientCount;
  }

  shutdown(): void {
    this.sseHandler.shutdown();
  }
}

export function createDevRouter(options: RouterOptions): DevAPIRouter {
  return new DevAPIRouter(options);
}
