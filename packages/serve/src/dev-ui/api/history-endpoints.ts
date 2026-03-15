import type { EndpointContext } from './types.js';
import { parseBody, sendJSON, sendError } from './helpers.js';

const VALID_STATUSES = ['started', 'completed', 'error'] as const;

/**
 * Validate imported query history entries.
 * Returns null if valid, error message if invalid.
 */
function validateImportData(data: unknown): string | null {
  if (!Array.isArray(data)) {
    return 'Import data must be an array';
  }
  if (data.length === 0) {
    return null;
  }
  if (data.length > 10000) {
    return 'Import data too large (max 10000 entries)';
  }

  for (let i = 0; i < data.length; i++) {
    const entry = data[i];
    if (!entry || typeof entry !== 'object') {
      return `Entry ${i}: must be an object`;
    }
    if (typeof entry.queryId !== 'string' || !entry.queryId) {
      return `Entry ${i}: missing or invalid queryId`;
    }
    if (typeof entry.query !== 'string') {
      return `Entry ${i}: missing or invalid query`;
    }
    if (typeof entry.startTime !== 'number') {
      return `Entry ${i}: missing or invalid startTime`;
    }
    if (!VALID_STATUSES.includes(entry.status)) {
      return `Entry ${i}: invalid status (must be started, completed, or error)`;
    }
  }

  return null;
}

/**
 * DELETE /__dev/queries
 * Clear all query history.
 */
export async function clearHistory(ctx: EndpointContext): Promise<void> {
  try {
    await ctx.store.clear();

    const result = { cleared: true, timestamp: Date.now() };
    ctx.sseHandler?.broadcast({ type: 'history:cleared', data: result });
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

    const validationError = validateImportData(body);
    if (validationError) {
      return sendError(ctx.res, validationError, 400);
    }

    const data = JSON.stringify(body);
    await ctx.store.import(data, 'json');

    const result = { imported: true, count: (body as unknown[]).length, timestamp: Date.now() };
    sendJSON(ctx.res, result);
  } catch (error) {
    console.error('[API] importHistory error:', error);
    sendError(ctx.res, (error as Error).message);
  }
}
