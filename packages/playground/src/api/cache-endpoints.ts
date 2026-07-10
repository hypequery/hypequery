import type { EndpointContext } from './types.js';
import { sendJSON, sendError } from './helpers.js';

/**
 * GET /__dev/cache
 * Cache performance statistics. Prefers the live serve-layer cache store when
 * present; otherwise derives hit/miss stats from persisted query history.
 * (Capability `cache` — the serve-layer cache store lands separately.)
 */
export async function getCacheStats(ctx: EndpointContext): Promise<void> {
  try {
    if (ctx.serveCacheStore) {
      const stats = await ctx.serveCacheStore.getStats();
      ctx.sseHandler?.broadcast({ type: 'cache:updated', data: stats });
      return sendJSON(ctx.res, stats);
    }

    const stats = await ctx.store.getCacheStats();
    ctx.sseHandler?.broadcast({ type: 'cache:updated', data: stats });
    sendJSON(ctx.res, stats);
  } catch (error) {
    console.error('[gateway] getCacheStats error:', error);
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

    const result = { cleared: true, timestamp: Date.now() };
    ctx.sseHandler?.broadcast({ type: 'cache:updated', data: result });
    sendJSON(ctx.res, result);
  } catch (error) {
    console.error('[gateway] clearCache error:', error);
    sendError(ctx.res, (error as Error).message);
  }
}
