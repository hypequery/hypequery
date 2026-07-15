import type { EndpointContext } from './types.js';
import { sendJSON, sendError } from './helpers.js';

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
