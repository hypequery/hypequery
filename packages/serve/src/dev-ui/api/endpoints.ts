import type { IncomingMessage, ServerResponse } from 'http';
import type { QueryHistoryStore, GetQueriesOptions } from '../storage/types.js';
import type { DevQueryLogger } from '../query-logger.js';
import type { SSEHandler } from './sse-handler.js';
import type { CacheStore } from '../../cache/types.js';

/**
 * Context passed to endpoint handlers.
 */
export interface EndpointContext {
  store: QueryHistoryStore;
  req: IncomingMessage;
  res: ServerResponse;
  logger?: DevQueryLogger;
  /** Serve-layer cache store for real-time cache stats and operations */
  serveCacheStore?: CacheStore;
  sseHandler?: SSEHandler;
  api?: ApiInstance;
}

/**
 * Minimal API instance interface for available queries.
 */
interface ApiInstance {
  endpoints?: Record<string, EndpointDefinition>;
  execute?: (key: string, options: { input?: unknown }) => Promise<unknown>;
}

interface EndpointDefinition {
  key?: string;
  path?: string;
  method?: string;
  description?: string;
  tags?: string[];
  inputSchema?: unknown;
  outputSchema?: unknown;
  metadata?: {
    path?: string;
    method?: string;
    name?: string;
    summary?: string;
    description?: string;
    tags?: string[];
    requiresAuth?: boolean;
    requiredRoles?: string[];
    requiredScopes?: string[];
    cacheTtlMs?: number | null;
    visibility?: string;
    custom?: Record<string, unknown>;
  };
  tenant?: unknown;
  cacheTtlMs?: number | null;
}

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Parse query parameters from URL.
 */
export function parseQueryParams(url: string): Record<string, string> {
  const params: Record<string, string> = {};
  const queryString = url.split('?')[1];

  if (!queryString) return params;

  for (const param of queryString.split('&')) {
    const [key, value] = param.split('=');
    if (key) {
      params[decodeURIComponent(key)] = decodeURIComponent(value || '');
    }
  }

  return params;
}

/**
 * Parse request body as JSON.
 */
export async function parseBody(req: IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    let body = '';

    req.on('data', (chunk: Buffer) => {
      body += chunk.toString();
    });

    req.on('end', () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch {
        reject(new Error('Invalid JSON'));
      }
    });

    req.on('error', reject);
  });
}

/**
 * Send JSON response.
 */
export function sendJSON(res: ServerResponse, data: unknown, status = 200): void {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(data));
}

/**
 * Send error response.
 */
export function sendError(res: ServerResponse, message: string, status = 500): void {
  sendJSON(res, { error: message }, status);
}

// ============================================================================
// Query Endpoints
// ============================================================================

/**
 * GET /__dev/queries
 * List query history with pagination and filtering.
 */
export async function getQueries(ctx: EndpointContext): Promise<void> {
  try {
    const params = parseQueryParams(ctx.req.url || '');

    const options: GetQueriesOptions = {
      limit: params.limit ? parseInt(params.limit, 10) : 50,
      offset: params.offset ? parseInt(params.offset, 10) : 0,
      status: params.status as 'started' | 'completed' | 'error' | undefined,
      search: params.search || undefined
    };

    // Validate limit
    if (isNaN(options.limit!) || options.limit! < 1 || options.limit! > 1000) {
      return sendError(ctx.res, 'Invalid limit (1-1000)', 400);
    }

    // Validate offset
    if (isNaN(options.offset!) || options.offset! < 0) {
      return sendError(ctx.res, 'Invalid offset (>=0)', 400);
    }

    // Validate status
    if (options.status && !['started', 'completed', 'error'].includes(options.status)) {
      return sendError(ctx.res, 'Invalid status (started, completed, error)', 400);
    }

    const result = await ctx.store.getQueries(options);
    sendJSON(ctx.res, result);
  } catch (error) {
    console.error('[API] getQueries error:', error);
    sendError(ctx.res, (error as Error).message);
  }
}

/**
 * GET /__dev/queries/:id
 * Get a single query by ID.
 */
export async function getQuery(ctx: EndpointContext, queryId: string): Promise<void> {
  try {
    if (!queryId) {
      return sendError(ctx.res, 'Query ID required', 400);
    }

    const query = await ctx.store.getQuery(queryId);

    if (!query) {
      return sendError(ctx.res, 'Query not found', 404);
    }

    sendJSON(ctx.res, query);
  } catch (error) {
    console.error('[API] getQuery error:', error);
    sendError(ctx.res, (error as Error).message);
  }
}

// ============================================================================
// Cache Endpoints
// ============================================================================

/**
 * GET /__dev/cache/stats
 * Get cache performance statistics from serve-layer cache.
 */
export async function getCacheStats(ctx: EndpointContext): Promise<void> {
  try {
    // Get serve-layer cache stats if available
    if (ctx.serveCacheStore) {
      const stats = ctx.serveCacheStore.getStats();

      // Broadcast updated stats via SSE
      ctx.sseHandler?.broadcast({
        type: 'cache:stats',
        data: stats
      });

      return sendJSON(ctx.res, stats);
    }

    // Fall back to query history cache stats
    const stats = await ctx.store.getCacheStats();

    // Broadcast updated stats via SSE
    ctx.sseHandler?.broadcast({
      type: 'cache:stats',
      data: stats
    });

    sendJSON(ctx.res, stats);
  } catch (error) {
    console.error('[API] getCacheStats error:', error);
    sendError(ctx.res, (error as Error).message);
  }
}

/**
 * POST /__dev/cache/invalidate
 * Invalidate specific cache keys.
 */
export async function invalidateCache(ctx: EndpointContext): Promise<void> {
  try {
    const body = await parseBody(ctx.req) as { cacheKeys?: string[], pattern?: string };
    const { cacheKeys, pattern } = body;

    if (!ctx.serveCacheStore) {
      return sendError(ctx.res, 'Cache not available', 503);
    }

    let invalidated = 0;

    // Invalidate by pattern
    if (pattern && typeof pattern === 'string') {
      invalidated = await ctx.serveCacheStore.deletePattern(pattern);
    }
    // Invalidate by specific keys
    else if (Array.isArray(cacheKeys)) {
      for (const key of cacheKeys) {
        if (typeof key === 'string') {
          const deleted = await ctx.serveCacheStore.delete(key);
          if (deleted) invalidated++;
        }
      }
    } else {
      return sendError(ctx.res, 'cacheKeys (array) or pattern (string) required', 400);
    }

    const result = { invalidated, keys: cacheKeys, pattern };

    // Broadcast invalidation event
    ctx.sseHandler?.broadcast({
      type: 'cache:invalidated',
      data: result
    });

    sendJSON(ctx.res, result);
  } catch (error) {
    console.error('[API] invalidateCache error:', error);
    sendError(ctx.res, (error as Error).message);
  }
}

/**
 * POST /__dev/cache/clear
 * Clear all cached data.
 */
export async function clearCache(ctx: EndpointContext): Promise<void> {
  try {
    if (!ctx.serveCacheStore) {
      return sendError(ctx.res, 'Cache not available', 503);
    }

    await ctx.serveCacheStore.clear();

    // Reset stats as well
    ctx.serveCacheStore.resetStats();

    const result = { cleared: true, timestamp: Date.now() };

    // Broadcast clear event
    ctx.sseHandler?.broadcast({
      type: 'cache:cleared',
      data: result
    });

    sendJSON(ctx.res, result);
  } catch (error) {
    console.error('[API] clearCache error:', error);
    sendError(ctx.res, (error as Error).message);
  }
}

// ============================================================================
// API Discovery Endpoints
// ============================================================================

/**
 * Registry entry for the dev UI.
 */
export interface RegistryEntry {
  key: string;
  name?: string;
  path: string;
  method: string;
  description?: string;
  tags: string[];
  // Schema info
  hasInput: boolean;
  inputFields?: string[];
  // Tenant info
  hasTenant: boolean;
  // Cache info
  isCached: boolean;
  cacheTtlMs?: number;
  // Auth info
  requiresAuth: boolean;
  requiredRoles?: string[];
  requiredScopes?: string[];
  // Visibility
  visibility?: string;
  // Custom metadata (dataset, dimensions, grains, etc.)
  custom?: Record<string, unknown>;
}

/**
 * Extract field names from a Zod schema (basic extraction).
 */
function extractSchemaFields(schema: unknown): string[] | undefined {
  if (!schema) return undefined;

  // Try to extract shape from Zod object schema
  const schemaAny = schema as { shape?: Record<string, unknown>; _def?: { shape?: () => Record<string, unknown> } };

  if (schemaAny.shape && typeof schemaAny.shape === 'object') {
    return Object.keys(schemaAny.shape);
  }

  if (schemaAny._def?.shape && typeof schemaAny._def.shape === 'function') {
    try {
      return Object.keys(schemaAny._def.shape());
    } catch {
      return undefined;
    }
  }

  return undefined;
}

/**
 * GET /__dev/registry
 * List all registered endpoints with full metadata for the registry screen.
 */
export async function getRegistry(ctx: EndpointContext): Promise<void> {
  try {
    if (!ctx.api?.endpoints) {
      return sendJSON(ctx.res, { entries: [], total: 0 });
    }

    const entries: RegistryEntry[] = Object.entries(ctx.api.endpoints).map(([key, endpoint]) => {
      const metadata = endpoint.metadata;
      const cacheTtl = endpoint.cacheTtlMs ?? metadata?.cacheTtlMs;

      return {
        key,
        name: metadata?.name || key,
        path: endpoint.path || metadata?.path || `/${key}`,
        method: endpoint.method || metadata?.method || 'GET',
        description: metadata?.description || endpoint.description,
        tags: metadata?.tags || endpoint.tags || [],
        // Schema info
        hasInput: endpoint.inputSchema !== undefined,
        inputFields: extractSchemaFields(endpoint.inputSchema),
        // Tenant info
        hasTenant: endpoint.tenant !== undefined,
        // Cache info
        isCached: cacheTtl !== undefined && cacheTtl !== null && cacheTtl > 0,
        cacheTtlMs: typeof cacheTtl === 'number' ? cacheTtl : undefined,
        // Auth info
        requiresAuth: metadata?.requiresAuth || false,
        requiredRoles: metadata?.requiredRoles,
        requiredScopes: metadata?.requiredScopes,
        // Visibility
        visibility: metadata?.visibility,
        // Custom metadata
        custom: metadata?.custom,
      };
    });

    sendJSON(ctx.res, { entries, total: entries.length });
  } catch (error) {
    console.error('[API] getRegistry error:', error);
    sendError(ctx.res, (error as Error).message);
  }
}

/**
 * GET /__dev/queries/available
 * List all available query endpoints (legacy, use getRegistry for full info).
 */
export async function getAvailableQueries(ctx: EndpointContext): Promise<void> {
  try {
    if (!ctx.api?.endpoints) {
      return sendJSON(ctx.res, { queries: [], total: 0 });
    }

    const queries = Object.entries(ctx.api.endpoints).map(([key, endpoint]) => ({
      key,
      path: endpoint.path || `/${key}`,
      method: endpoint.method || 'GET',
      description: endpoint.description,
      tags: endpoint.tags || [],
      hasInput: endpoint.inputSchema !== undefined
    }));

    sendJSON(ctx.res, { queries, total: queries.length });
  } catch (error) {
    console.error('[API] getAvailableQueries error:', error);
    sendError(ctx.res, (error as Error).message);
  }
}

// ============================================================================
// Logger Endpoints
// ============================================================================

/**
 * GET /__dev/logger/stats
 * Get query logger performance statistics.
 */
export async function getLoggerStats(ctx: EndpointContext): Promise<void> {
  try {
    if (!ctx.logger) {
      return sendError(ctx.res, 'Logger not available', 503);
    }

    const stats = ctx.logger.getStats();
    sendJSON(ctx.res, stats);
  } catch (error) {
    console.error('[API] getLoggerStats error:', error);
    sendError(ctx.res, (error as Error).message);
  }
}

// ============================================================================
// History Management Endpoints
// ============================================================================

/**
 * DELETE /__dev/queries
 * Clear all query history.
 */
export async function clearHistory(ctx: EndpointContext): Promise<void> {
  try {
    await ctx.store.clear();

    const result = { cleared: true, timestamp: Date.now() };

    // Broadcast clear event
    ctx.sseHandler?.broadcast({
      type: 'history:cleared',
      data: result
    });

    sendJSON(ctx.res, result);
  } catch (error) {
    console.error('[API] clearHistory error:', error);
    sendError(ctx.res, (error as Error).message);
  }
}

/**
 * GET /__dev/export
 * Export query history as JSON.
 */
export async function exportHistory(ctx: EndpointContext): Promise<void> {
  try {
    const data = await ctx.store.export('json');

    ctx.res.writeHead(200, {
      'Content-Type': 'application/json',
      'Content-Disposition': `attachment; filename="query-history-${Date.now()}.json"`
    });
    ctx.res.end(data);
  } catch (error) {
    console.error('[API] exportHistory error:', error);
    sendError(ctx.res, (error as Error).message);
  }
}

/**
 * POST /__dev/import
 * Import query history from JSON.
 */
export async function importHistory(ctx: EndpointContext): Promise<void> {
  try {
    const body = await parseBody(ctx.req);
    const data = JSON.stringify(body);

    await ctx.store.import(data, 'json');

    const result = { imported: true, timestamp: Date.now() };

    sendJSON(ctx.res, result);
  } catch (error) {
    console.error('[API] importHistory error:', error);
    sendError(ctx.res, (error as Error).message);
  }
}

// ============================================================================
// Playground Endpoints
// ============================================================================

/**
 * GET /__dev/playground/queries
 * List all available query endpoints with their schemas.
 */
export async function getPlaygroundQueries(ctx: EndpointContext): Promise<void> {
  try {
    if (!ctx.api?.endpoints) {
      return sendJSON(ctx.res, { queries: [], total: 0 });
    }

    const queries = Object.entries(ctx.api.endpoints).map(([key, endpoint]) => ({
      key,
      path: endpoint.path || `/${key}`,
      method: endpoint.method || 'GET',
      description: endpoint.description,
      tags: endpoint.tags || [],
      inputSchema: endpoint.inputSchema ?? null,
      outputSchema: endpoint.outputSchema ?? null
    }));

    sendJSON(ctx.res, { queries, total: queries.length });
  } catch (error) {
    console.error('[API] getPlaygroundQueries error:', error);
    sendError(ctx.res, (error as Error).message);
  }
}

/**
 * POST /__dev/playground/execute
 * Execute a query from the playground.
 */
export async function executePlaygroundQuery(ctx: EndpointContext): Promise<void> {
  const startTime = Date.now();

  try {
    const body = await parseBody(ctx.req) as {
      queryKey?: string;
      input?: unknown;
    };

    const { queryKey, input } = body;

    // Validate queryKey
    if (!queryKey || typeof queryKey !== 'string') {
      return sendError(ctx.res, 'queryKey is required', 400);
    }

    // Check that query exists
    if (!ctx.api?.endpoints?.[queryKey]) {
      return sendError(ctx.res, `Query '${queryKey}' not found`, 404);
    }

    // Check that execute is available
    if (!ctx.api.execute) {
      return sendError(ctx.res, 'Query execution not available', 503);
    }

    // Execute the query
    const result = await ctx.api.execute(queryKey, { input });

    const duration = Date.now() - startTime;

    // Broadcast execution event via SSE
    ctx.sseHandler?.broadcast({
      type: 'playground:executed',
      data: {
        queryKey,
        duration,
        success: true,
        timestamp: Date.now()
      }
    });

    sendJSON(ctx.res, {
      success: true,
      queryKey,
      result,
      duration,
      timestamp: Date.now()
    });
  } catch (error) {
    const duration = Date.now() - startTime;
    const errorMessage = error instanceof Error ? error.message : String(error);

    console.error('[API] executePlaygroundQuery error:', error);

    // Broadcast error event via SSE
    ctx.sseHandler?.broadcast({
      type: 'playground:error',
      data: {
        error: errorMessage,
        duration,
        timestamp: Date.now()
      }
    });

    sendJSON(ctx.res, {
      success: false,
      error: errorMessage,
      duration,
      timestamp: Date.now()
    }, 500);
  }
}
