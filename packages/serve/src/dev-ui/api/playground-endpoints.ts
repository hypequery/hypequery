import type { EndpointContext } from './types.js';
import { parseBody, sendJSON, sendError } from './helpers.js';

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

    if (!queryKey || typeof queryKey !== 'string') {
      return sendError(ctx.res, 'queryKey is required', 400);
    }

    if (!ctx.api?.endpoints?.[queryKey]) {
      return sendError(ctx.res, `Query '${queryKey}' not found`, 404);
    }

    if (!ctx.api.execute) {
      return sendError(ctx.res, 'Query execution not available', 503);
    }

    const result = await ctx.api.execute(queryKey, { input });
    const duration = Date.now() - startTime;

    ctx.sseHandler?.broadcast({
      type: 'playground:executed',
      data: { queryKey, duration, success: true, timestamp: Date.now() }
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

    ctx.sseHandler?.broadcast({
      type: 'playground:error',
      data: { error: errorMessage, duration, timestamp: Date.now() }
    });

    sendJSON(ctx.res, {
      success: false,
      error: errorMessage,
      duration,
      timestamp: Date.now()
    }, 500);
  }
}
