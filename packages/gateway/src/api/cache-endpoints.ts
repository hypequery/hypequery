import type { EndpointContext } from './types.js';
import { parseBody, sendJSON, sendError } from './helpers.js';

async function buildCacheStatsPayload(ctx: EndpointContext) {
  const layers = (await ctx.cacheObservability?.getStats()) ?? [];
  return layers.length > 0
    ? { layers }
    : {
        layers: [
          {
            layer: 'history',
            stats: await ctx.store.getCacheStats(),
            clearSupported: false
          }
        ]
      };
}

/**
 * GET /__dev/cache
 * Per-layer cache stats (gateway contract v0: `{ layers: [...] }`). Layers
 * come from serve's cache observability (semantic + builder); when none are
 * observable yet, an approximate `history` layer is derived from persisted
 * query history. Layer ids are additive under the contract.
 */
export async function getCacheStats(ctx: EndpointContext): Promise<void> {
  try {
    const payload = await buildCacheStatsPayload(ctx);
    sendJSON(ctx.res, payload);
  } catch (error) {
    console.error('[gateway] getCacheStats error:', error);
    sendError(ctx.res, (error as Error).message);
  }
}

/**
 * POST /__dev/cache/clear
 * Body: `{ layer?: string }` — clears the named layer, or every clearable
 * layer when omitted. 503 when nothing was cleared: either no layer supports
 * clearing (defense against clients ignoring the `cache:clear` capability)
 * or the named layer is unknown/unclearable.
 */
export async function clearCache(ctx: EndpointContext): Promise<void> {
  try {
    const observability = ctx.cacheObservability;
    if (!observability) {
      return sendError(ctx.res, 'Cache clearing not available', 503);
    }

    const body = (await parseBody(ctx.req)) as { layer?: string } | undefined;
    // The observability API narrows layer ids at compile time; request-body
    // strings pass through and unknown ids safely clear nothing.
    const layer = body?.layer as Parameters<typeof observability.clear>[0];
    const { cleared } = await observability.clear(layer);

    if (cleared.length === 0) {
      return sendError(ctx.res, 'Cache clearing not available', 503);
    }

    const result = { cleared, timestamp: Date.now() };
    try {
      const payload = await buildCacheStatsPayload(ctx);
      ctx.sseHandler?.broadcast({ type: 'cache:updated', data: payload });
    } catch (error) {
      console.error('[gateway] failed to broadcast cache stats after clear:', error);
    }
    sendJSON(ctx.res, result);
  } catch (error) {
    console.error('[gateway] clearCache error:', error);
    sendError(ctx.res, (error as Error).message);
  }
}
