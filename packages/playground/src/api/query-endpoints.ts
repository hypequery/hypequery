import type { GetQueriesOptions } from '../storage/types.js';
import type { EndpointContext } from './types.js';
import { parseQueryParams, sendJSON, sendError } from './helpers.js';

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

    if (isNaN(options.limit!) || options.limit! < 1 || options.limit! > 1000) {
      return sendError(ctx.res, 'Invalid limit (1-1000)', 400);
    }

    if (isNaN(options.offset!) || options.offset! < 0) {
      return sendError(ctx.res, 'Invalid offset (>=0)', 400);
    }

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
