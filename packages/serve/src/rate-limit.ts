import type { AuthContext, ServeRequest, ServeMiddleware, EndpointContext } from './types.js';

/**
 * Rate limit store interface.
 * Implement this for custom backends (Redis, Memcached, etc.).
 */
export interface RateLimitStore {
  /**
   * Increment the hit count for a key within the given window.
   * @returns The current hit count after incrementing.
   */
  increment(key: string, windowMs: number): Promise<number>;
  /**
   * Get the remaining TTL in milliseconds for a key.
   * Returns 0 if the key has no active window.
   */
  getTtl(key: string): Promise<number>;
  /**
   * Reset the counter for a key.
   */
  reset(key: string): Promise<void>;
}

export interface RateLimitConfig<
  TContext extends Record<string, unknown> = Record<string, unknown>,
  TAuth extends AuthContext = AuthContext,
> {
  /**
   * Time window in milliseconds.
   * @default 60000 (1 minute)
   */
  windowMs?: number;
  /**
   * Maximum number of requests allowed per window.
   * @default 100
   */
  max?: number;
  /**
   * Function to derive the rate limit key from the request context.
   * Defaults to IP-based limiting (from x-forwarded-for or x-real-ip).
   */
  keyBy?: (ctx: EndpointContext<unknown, TContext, TAuth>) => string | null;
  /**
   * Custom store implementation. Defaults to an in-memory store.
   */
  store?: RateLimitStore;
  /**
   * Whether to include rate limit headers in the response.
   * @default true
   */
  headers?: boolean;
  /**
   * Custom message to return when rate limited.
   * @default "Too many requests, please try again later"
   */
  message?: string;
  /**
   * If true, skip rate limiting instead of rejecting when the store fails.
   * @default true
   */
  failOpen?: boolean;
}

// ---------------------------------------------------------------------------
// In-memory store (single-process, no external deps)
// ---------------------------------------------------------------------------

interface MemoryEntry {
  count: number;
  expiresAt: number;
}

export class MemoryRateLimitStore implements RateLimitStore {
  private entries = new Map<string, MemoryEntry>();
  private cleanupTimer: ReturnType<typeof setInterval>;

  constructor(cleanupIntervalMs = 60_000) {
    // Periodic cleanup of expired entries to prevent memory leaks
    this.cleanupTimer = setInterval(() => {
      const now = Date.now();
      for (const [key, entry] of this.entries) {
        if (entry.expiresAt <= now) {
          this.entries.delete(key);
        }
      }
    }, cleanupIntervalMs);
    // Unref so the timer doesn't keep the process alive
    if (typeof this.cleanupTimer === 'object' && 'unref' in this.cleanupTimer) {
      (this.cleanupTimer as { unref(): void }).unref();
    }
  }

  async increment(key: string, windowMs: number): Promise<number> {
    const now = Date.now();
    const existing = this.entries.get(key);

    if (existing && existing.expiresAt > now) {
      existing.count++;
      return existing.count;
    }

    // New window
    this.entries.set(key, { count: 1, expiresAt: now + windowMs });
    return 1;
  }

  async getTtl(key: string): Promise<number> {
    const entry = this.entries.get(key);
    if (!entry) return 0;
    const remaining = entry.expiresAt - Date.now();
    return remaining > 0 ? remaining : 0;
  }

  async reset(key: string): Promise<void> {
    this.entries.delete(key);
  }

  destroy(): void {
    clearInterval(this.cleanupTimer);
    this.entries.clear();
  }
}

// ---------------------------------------------------------------------------
// Key extraction helpers
// ---------------------------------------------------------------------------

const defaultKeyExtractor = (ctx: EndpointContext<unknown, any, any>): string | null => {
  const req = ctx.request;
  return (
    req.headers['x-forwarded-for']?.split(',')[0]?.trim() ??
    req.headers['x-real-ip'] ??
    'unknown'
  );
};

// ---------------------------------------------------------------------------
// Middleware factory
// ---------------------------------------------------------------------------

/**
 * Creates a rate-limiting middleware.
 *
 * @example Global rate limit:
 * ```ts
 * const api = defineServe({
 *   queries: { ... },
 *   middlewares: [rateLimit({ windowMs: 60_000, max: 100 })],
 * });
 * ```
 *
 * @example Per-tenant rate limit on a single query:
 * ```ts
 * query
 *   .use(rateLimit({ max: 50, keyBy: (ctx) => ctx.auth?.tenantId ?? null }))
 *   .query(async ({ ctx, input }) => { ... })
 * ```
 */
export const rateLimit = <
  TContext extends Record<string, unknown> = Record<string, unknown>,
  TAuth extends AuthContext = AuthContext,
>(
  config: RateLimitConfig<TContext, TAuth> = {},
): ServeMiddleware<any, any, TContext, TAuth> => {
  const windowMs = config.windowMs ?? 60_000;
  const max = config.max ?? 100;
  const keyBy = config.keyBy ?? defaultKeyExtractor;
  const store = config.store ?? new MemoryRateLimitStore();
  const includeHeaders = config.headers !== false;
  const message = config.message ?? 'Too many requests, please try again later';
  const failOpen = config.failOpen !== false;

  return async (ctx, next) => {
    const key = keyBy(ctx as EndpointContext<unknown, TContext, TAuth>);

    // If we can't derive a key, skip rate limiting
    if (!key) {
      return next();
    }

    const rateLimitKey = `rl:${ctx.metadata.path}:${key}`;

    let current: number;
    let ttl: number;

    try {
      current = await store.increment(rateLimitKey, windowMs);
      ttl = await store.getTtl(rateLimitKey);
    } catch {
      if (failOpen) {
        return next();
      }
      throw Object.assign(new Error('Rate limiter unavailable'), {
        status: 503,
        payload: {
          type: 'SERVICE_UNAVAILABLE' as const,
          message: 'Rate limiter unavailable',
        },
      });
    }

    // Attach rate limit info to locals so hooks/handlers can inspect it
    ctx.locals._rateLimit = { limit: max, remaining: Math.max(0, max - current), resetMs: ttl };

    if (current > max) {
      const retryAfterSec = Math.ceil(ttl / 1000);
      const error = Object.assign(new Error(message), {
        status: 429,
        headers: {
          'retry-after': String(retryAfterSec),
          ...(includeHeaders
            ? {
                'x-ratelimit-limit': String(max),
                'x-ratelimit-remaining': '0',
                'x-ratelimit-reset': String(retryAfterSec),
              }
            : {}),
        },
        payload: {
          type: 'RATE_LIMITED' as const,
          message,
        },
      });
      throw error;
    }

    // Execute downstream handler
    const result = await next();

    // We can't directly set headers from middleware in the current architecture,
    // but the rate limit info is available via ctx.locals._rateLimit
    // for the lifecycle hooks or future header injection.

    return result;
  };
};
