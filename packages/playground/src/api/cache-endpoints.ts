import type { EndpointContext } from './types.js';
import { parseBody, sendJSON, sendError } from './helpers.js';

/** Maximum regex pattern length to prevent ReDoS */
const MAX_PATTERN_LENGTH = 200;

/**
 * Validate a regex pattern is safe to use.
 * Returns null if invalid, the pattern string if valid.
 */
function validatePattern(pattern: string): string | null {
  if (pattern.length > MAX_PATTERN_LENGTH) {
    return null;
  }
  const dangerousPatterns = [
    /\(\.\*\)\+/,
    /\(\.\+\)\+/,
    /\([^)]*\+[^)]*\)\+/,
  ];
  for (const dangerous of dangerousPatterns) {
    if (dangerous.test(pattern)) {
      return null;
    }
  }
  try {
    new RegExp(pattern);
    return pattern;
  } catch {
    return null;
  }
}

/**
 * GET /__dev/cache/stats
 * Get cache performance statistics from serve-layer cache.
 */
export async function getCacheStats(ctx: EndpointContext): Promise<void> {
  try {
    if (ctx.serveCacheStore) {
      const stats = ctx.serveCacheStore.getStats();
      ctx.sseHandler?.broadcast({ type: 'cache:stats', data: stats });
      return sendJSON(ctx.res, stats);
    }

    const stats = await ctx.store.getCacheStats();
    ctx.sseHandler?.broadcast({ type: 'cache:stats', data: stats });
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

    if (pattern && typeof pattern === 'string') {
      const safePattern = validatePattern(pattern);
      if (!safePattern) {
        return sendError(ctx.res, 'Invalid or unsafe pattern', 400);
      }
      invalidated = await ctx.serveCacheStore.deletePattern(safePattern);
    } else if (Array.isArray(cacheKeys)) {
      for (const key of cacheKeys) {
        if (typeof key === 'string') {
          const deleted = await ctx.serveCacheStore.delete(key);
          if (deleted) invalidated++;
        }
      }
    } else {
      return sendError(ctx.res, 'cacheKeys (array) or pattern (string) required', 400);
    }

    const result = { invalidated, pattern: pattern || undefined };
    ctx.sseHandler?.broadcast({ type: 'cache:invalidated', data: result });
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
    ctx.serveCacheStore.resetStats();

    const result = { cleared: true, timestamp: Date.now() };
    ctx.sseHandler?.broadcast({ type: 'cache:cleared', data: result });
    sendJSON(ctx.res, result);
  } catch (error) {
    console.error('[API] clearCache error:', error);
    sendError(ctx.res, (error as Error).message);
  }
}
