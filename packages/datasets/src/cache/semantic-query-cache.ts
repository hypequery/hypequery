/**
 * Semantic query result cache.
 *
 * Sits between `DatasetClient.execute()` and the underlying query builder /
 * backend, keyed by the canonical query signature (see query-signature.ts).
 * Supports TTL freshness, an optional stale-while-revalidate window, and
 * deduplication of concurrent identical misses so a burst of the same query
 * executes once.
 *
 * Values are cloned on write and on read: callers can mutate results freely
 * without contaminating the cache, and cached hits never alias each other.
 */

export interface SemanticCacheEntry {
  value: unknown;
  storedAt: number;
}

/**
 * Pluggable store. The default is an in-process LRU; provide a custom store
 * (e.g. Redis-backed) for multi-instance deployments. Stores hold opaque
 * entries — freshness is decided by the cache from `storedAt` and the
 * effective TTL, so per-call TTLs work against shared entries.
 */
export interface SemanticCacheStore {
  get(key: string): SemanticCacheEntry | undefined | Promise<SemanticCacheEntry | undefined>;
  set(key: string, entry: SemanticCacheEntry): void | Promise<void>;
  delete(key: string): void | Promise<void>;
  clear?(): void | Promise<void>;
}

/** Client-level cache defaults (see `CreateDatasetClientOptions.cache`). */
export interface SemanticCacheOptions {
  /** Fresh window in milliseconds. 0 / omitted = only per-call opt-in caches. */
  ttlMs?: number;
  /**
   * Additional window after `ttlMs` during which a stale result is returned
   * immediately while a background refresh repopulates the entry.
   */
  staleWhileRevalidateMs?: number;
  /** Max entries for the default in-memory store. Ignored when `store` is set. */
  maxEntries?: number;
  /** Custom store; defaults to an in-process LRU. */
  store?: SemanticCacheStore;
}

/** Per-call cache controls, passed via `ExecutionContext.cache`. */
export interface SemanticCacheRuntime {
  /** Overrides the client-level TTL for this call. */
  ttlMs?: number;
  /** Overrides the client-level stale-while-revalidate window for this call. */
  staleWhileRevalidateMs?: number;
  /**
   * `bypass` skips the cache entirely (no read, no write);
   * `refresh` skips the read but stores the fresh result.
   */
  mode?: 'bypass' | 'refresh';
}

/** Cache observability attached to `meta.cache` on cached-path results. */
export interface SemanticCacheMetaInfo {
  hit: boolean;
  /** Milliseconds since the entry was stored; only on hits. */
  ageMs?: number;
  /** True when served from the stale-while-revalidate window. */
  stale?: boolean;
}

const DEFAULT_MAX_ENTRIES = 500;

export function createMemoryCacheStore(
  options: { maxEntries?: number } = {},
): SemanticCacheStore {
  const maxEntries = options.maxEntries ?? DEFAULT_MAX_ENTRIES;
  const entries = new Map<string, SemanticCacheEntry>();

  return {
    get(key) {
      const entry = entries.get(key);
      if (!entry) {
        return undefined;
      }
      // LRU: re-insert on access so iteration order tracks recency.
      entries.delete(key);
      entries.set(key, entry);
      return entry;
    },
    set(key, entry) {
      entries.delete(key);
      entries.set(key, entry);
      while (entries.size > maxEntries) {
        const oldest = entries.keys().next().value;
        if (oldest === undefined) break;
        entries.delete(oldest);
      }
    },
    delete(key) {
      entries.delete(key);
    },
    clear() {
      entries.clear();
    },
  };
}

interface ResolvedCacheConfig {
  ttlMs: number;
  staleWhileRevalidateMs: number;
  mode: 'read-write' | 'refresh';
}

type CacheableResult = { meta?: object };

function isPromise<T>(value: T | Promise<T>): value is Promise<T> {
  return typeof (value as { then?: unknown } | null | undefined)?.['then' as never] === 'function';
}

function cloneValue<T>(value: T): T {
  return structuredClone(value);
}

function annotate<T extends CacheableResult>(result: T, info: SemanticCacheMetaInfo): T {
  return {
    ...result,
    meta: { ...(result.meta ?? {}), cache: info },
  } as T;
}

export class SemanticQueryCache {
  private readonly store: SemanticCacheStore;
  private readonly defaults: SemanticCacheOptions;
  private readonly pending = new Map<string, Promise<CacheableResult>>();
  private readonly refreshing = new Set<string>();

  constructor(options: SemanticCacheOptions = {}) {
    this.defaults = options;
    this.store = options.store ?? createMemoryCacheStore({ maxEntries: options.maxEntries });
  }

  private resolveConfig(
    runtime: SemanticCacheRuntime | false | undefined,
  ): ResolvedCacheConfig | undefined {
    if (runtime === false) {
      return undefined;
    }
    if (runtime?.mode === 'bypass') {
      return undefined;
    }
    const ttlMs = runtime?.ttlMs ?? this.defaults.ttlMs ?? 0;
    if (ttlMs <= 0) {
      return undefined;
    }
    return {
      ttlMs,
      staleWhileRevalidateMs:
        runtime?.staleWhileRevalidateMs ?? this.defaults.staleWhileRevalidateMs ?? 0,
      mode: runtime?.mode === 'refresh' ? 'refresh' : 'read-write',
    };
  }

  /**
   * Runs `execute` through the cache. Errors are never cached; concurrent
   * identical misses share one execution.
   */
  async through<T extends CacheableResult>(
    key: string,
    execute: () => Promise<T>,
    runtime?: SemanticCacheRuntime | false,
  ): Promise<T> {
    const config = this.resolveConfig(runtime);
    if (!config) {
      return execute();
    }

    if (config.mode !== 'refresh') {
      // Avoid awaiting synchronous stores so the pending-map registration
      // below happens before control returns to the caller — that is what
      // makes back-to-back identical calls share one execution.
      const read = this.store.get(key);
      const entry = isPromise(read) ? await read : read;
      if (entry) {
        const ageMs = Date.now() - entry.storedAt;
        if (ageMs <= config.ttlMs) {
          return annotate(cloneValue(entry.value) as T, { hit: true, ageMs });
        }
        if (ageMs <= config.ttlMs + config.staleWhileRevalidateMs) {
          this.refreshInBackground(key, execute);
          return annotate(cloneValue(entry.value) as T, { hit: true, ageMs, stale: true });
        }
      }
    }

    const inFlight = this.pending.get(key);
    if (inFlight) {
      // Piggyback on the identical in-flight execution; clone so concurrent
      // callers never share a result object.
      return annotate(cloneValue(await inFlight) as T, { hit: false });
    }

    const promise = (async () => {
      const value = await execute();
      await this.store.set(key, { value: cloneValue(value), storedAt: Date.now() });
      return value;
    })();

    this.pending.set(key, promise);
    try {
      return annotate((await promise) as T, { hit: false });
    } finally {
      this.pending.delete(key);
    }
  }

  private refreshInBackground(key: string, execute: () => Promise<CacheableResult>): void {
    if (this.refreshing.has(key)) {
      return;
    }
    this.refreshing.add(key);
    void execute()
      .then((value) => this.store.set(key, { value: cloneValue(value), storedAt: Date.now() }))
      .catch(() => {
        // Stale entry stays; the next caller past the SWR window re-executes.
      })
      .finally(() => {
        this.refreshing.delete(key);
      });
  }
}
