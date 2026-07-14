/**
 * Semantic query result cache.
 *
 * Sits between `DatasetClient.execute()` and the underlying query builder /
 * backend, keyed by the canonical query signature (see query-signature.ts).
 * Supports TTL freshness, an optional stale-while-revalidate window, and
 * deduplication of concurrent identical lookups so a burst of the same query
 * executes once — including against async stores, where the in-flight lookup
 * is registered before the store read. Piggybacked callers inherit the
 * initiating caller's TTL resolution.
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
 *
 * Store errors are non-fatal: a failed read is treated as a miss and a failed
 * write is dropped, so a store outage degrades to uncached execution rather
 * than failing queries.
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
  /**
   * Default cache partition included in every key. Set this when multiple
   * clients pointing at different data sources share one store (e.g. Redis),
   * so identical queries against different backends never collide.
   */
  scope?: string;
}

/** Per-call cache controls, passed via `ExecutionContext.cache`. */
export interface SemanticCacheRuntime {
  /** Overrides the client-level TTL for this call. */
  ttlMs?: number;
  /** Overrides the client-level stale-while-revalidate window for this call. */
  staleWhileRevalidateMs?: number;
  /**
   * `bypass` skips the cache entirely (no read, no write);
   * `refresh` skips the read but stores the fresh result. Refresh needs a
   * TTL (per-call or client-level) to store under; when neither is
   * configured it executes uncached and logs a one-time warning.
   */
  mode?: 'bypass' | 'refresh';
  /**
   * Cache partition for this call, mixed into the query signature. Required
   * to cache calls that override the query builder via `runtime.builderFactory`
   * — without it such calls bypass the cache, because the key alone cannot
   * tell two data sources apart.
   */
  scope?: string;
}

/** Cache observability attached to `meta.cache` on cached-path results. */
export interface SemanticCacheMetaInfo {
  hit: boolean;
  /** Milliseconds since the entry was stored; only on hits. */
  ageMs?: number;
  /** True when served from the stale-while-revalidate window. */
  stale?: boolean;
}

/**
 * Aggregate lookup counters, snapshot via `SemanticQueryCache.getStats()`.
 *
 * Counters are per cache instance and in-process: with a shared store (e.g.
 * Redis) each process reports its own lookups, not cluster-wide totals. Every
 * caller counts once — concurrent callers deduplicated onto one execution
 * each record their own outcome. Bypassed calls (no TTL, `cache: false`,
 * `mode: 'bypass'`, unscoped builder overrides) never reach the cache and are
 * not counted.
 */
export interface SemanticCacheStats {
  /** Fresh hits (within TTL). */
  hits: number;
  /** Lookups that executed the query (includes `mode: 'refresh'` calls). */
  misses: number;
  /** Hits served from the stale-while-revalidate window. */
  staleHits: number;
  /** (hits + staleHits) / total lookups; 0 when no lookups yet. */
  hitRate: number;
  /** Whether `clear()` can clear entries (the store implements `clear`). */
  clearSupported: boolean;
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

/** Result of one deduplicated lookup-or-execute, shared by concurrent callers. */
interface LookupOutcome {
  value: unknown;
  info: SemanticCacheMetaInfo;
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
    // Copy `info`: the same outcome is annotated onto every concurrent
    // caller's result, and results must never alias each other.
    meta: { ...(result.meta ?? {}), cache: { ...info } },
  } as T;
}

export class SemanticQueryCache {
  private readonly store: SemanticCacheStore;
  private readonly defaults: SemanticCacheOptions;
  private readonly pending = new Map<string, Promise<LookupOutcome>>();
  private readonly refreshing = new Set<string>();
  private warnedRefreshWithoutTtl = false;
  private hits = 0;
  private misses = 0;
  private staleHits = 0;

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
      // A misconfigured refresh must not fail the request — the fresh result
      // is still correct — but it should not go undiagnosed either.
      if (runtime?.mode === 'refresh' && !this.warnedRefreshWithoutTtl) {
        this.warnedRefreshWithoutTtl = true;
        console.warn(
          "[hypequery/cache] mode 'refresh' has no TTL to store under; executing uncached. " +
            'Pass ttlMs on the call or configure cache.ttlMs on the client.',
        );
      }
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

    if (config.mode === 'refresh') {
      // Refresh callers asked for an isolated fresh read: never piggyback on
      // an in-flight miss, just execute and repopulate the entry.
      const value = await execute();
      await this.writeEntry(key, value);
      this.record({ hit: false });
      return annotate(value as T, { hit: false });
    }

    const inFlight = this.pending.get(key);
    if (inFlight) {
      // Piggyback on the identical in-flight lookup; clone so concurrent
      // callers never share a result object. The outcome (hit, staleness) was
      // resolved with the initiating caller's TTL configuration.
      const shared = await inFlight;
      this.record(shared.info);
      return annotate(cloneValue(shared.value) as T, shared.info);
    }

    // The pending registration below happens synchronously, before the store
    // read inside the IIFE — that is what makes concurrent identical calls
    // share one execution even with an async store (e.g. Redis), where a
    // read snapshot taken before our write would otherwise miss and re-run.
    const promise = (async (): Promise<LookupOutcome> => {
      let entry: SemanticCacheEntry | undefined;
      try {
        // Avoid the extra microtask when the store answers synchronously.
        const read = this.store.get(key);
        entry = isPromise(read) ? await read : read;
      } catch {
        // Read failed; treat it as a miss so a store outage degrades to
        // "no caching" instead of failing the query.
      }
      if (entry) {
        const ageMs = Date.now() - entry.storedAt;
        if (ageMs <= config.ttlMs) {
          return { value: entry.value, info: { hit: true, ageMs } };
        }
        if (ageMs <= config.ttlMs + config.staleWhileRevalidateMs) {
          this.refreshInBackground(key, execute);
          return { value: entry.value, info: { hit: true, ageMs, stale: true } };
        }
      }
      const value = await execute();
      await this.writeEntry(key, value);
      return { value, info: { hit: false } };
    })();

    this.pending.set(key, promise);
    try {
      const outcome = await promise;
      this.record(outcome.info);
      // Hits alias the stored entry and must be cloned; a freshly executed
      // result is owned by this caller.
      const value = outcome.info.hit ? cloneValue(outcome.value) : outcome.value;
      return annotate(value as T, outcome.info);
    } finally {
      this.pending.delete(key);
    }
  }

  private record(info: SemanticCacheMetaInfo): void {
    if (info.stale) {
      this.staleHits += 1;
    } else if (info.hit) {
      this.hits += 1;
    } else {
      this.misses += 1;
    }
  }

  /** Snapshot of this instance's lookup counters (see `SemanticCacheStats`). */
  getStats(): SemanticCacheStats {
    const total = this.hits + this.misses + this.staleHits;
    return {
      hits: this.hits,
      misses: this.misses,
      staleHits: this.staleHits,
      hitRate: total > 0 ? (this.hits + this.staleHits) / total : 0,
      clearSupported: typeof this.store.clear === 'function',
    };
  }

  /**
   * Clears all entries. Returns false without touching anything when the
   * store does not implement `clear` (see `SemanticCacheStats.clearSupported`
   * — callers advertising a clear affordance should check it first). Lookup
   * counters are not reset: they count lookups, not entries.
   */
  async clear(): Promise<boolean> {
    if (typeof this.store.clear !== 'function') {
      return false;
    }
    await this.store.clear();
    return true;
  }

  /** Best-effort write: a failing store degrades to "no caching", never a failed call. */
  private async writeEntry(key: string, value: unknown): Promise<void> {
    try {
      await this.store.set(key, { value: cloneValue(value), storedAt: Date.now() });
    } catch {
      // Cache write failed; the fresh result is still returned to the caller.
    }
  }

  private refreshInBackground(key: string, execute: () => Promise<CacheableResult>): void {
    if (this.refreshing.has(key)) {
      return;
    }
    this.refreshing.add(key);
    void execute()
      .then((value) => this.writeEntry(key, value))
      .catch(() => {
        // Stale entry stays; the next caller past the SWR window re-executes.
      })
      .finally(() => {
        this.refreshing.delete(key);
      });
  }
}
