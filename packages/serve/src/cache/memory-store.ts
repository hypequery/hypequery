import type {
  CacheEntry,
  CacheLookupResult,
  CacheSetOptions,
  CacheStats,
  CacheStore,
} from './types.js';

interface MemoryStoreOptions {
  /**
   * Maximum number of entries. When exceeded, LRU eviction is triggered.
   * @default 1000
   */
  maxEntries?: number;

  /**
   * Interval in ms for running cleanup of expired entries.
   * @default 60000 (1 minute)
   */
  cleanupIntervalMs?: number;
}

/**
 * In-memory cache store with LRU eviction.
 */
export class MemoryCacheStore implements CacheStore {
  private cache = new Map<string, CacheEntry>();
  private accessOrder: string[] = [];
  private maxEntries: number;
  private cleanupInterval: ReturnType<typeof setInterval> | null = null;

  // Stats
  private hits = 0;
  private misses = 0;
  private staleHits = 0;
  private bypassed = 0;
  private totalAgeMs = 0;
  private ageCount = 0;

  constructor(options: MemoryStoreOptions = {}) {
    this.maxEntries = options.maxEntries ?? 1000;

    const cleanupMs = options.cleanupIntervalMs ?? 60000;
    if (cleanupMs > 0) {
      this.cleanupInterval = setInterval(() => this.cleanup(), cleanupMs);
      // Don't prevent process exit
      if (this.cleanupInterval.unref) {
        this.cleanupInterval.unref();
      }
    }
  }

  async get<T = unknown>(key: string): Promise<CacheLookupResult<T>> {
    const entry = this.cache.get(key);

    if (!entry) {
      this.misses++;
      return { status: 'miss' };
    }

    const now = Date.now();
    const age = now - entry.createdAt;
    const isExpired = age > entry.ttlMs;
    const isStale = isExpired && entry.staleWhileRevalidateMs
      ? age <= entry.ttlMs + entry.staleWhileRevalidateMs
      : false;

    if (isExpired && !isStale) {
      // Fully expired, remove and return miss
      this.cache.delete(key);
      this.removeFromAccessOrder(key);
      this.misses++;
      return { status: 'miss' };
    }

    // Update access order for LRU
    this.touchAccessOrder(key);
    this.totalAgeMs += age;
    this.ageCount++;

    if (isStale) {
      this.staleHits++;
      return { status: 'stale', value: entry.value as T, age };
    }

    this.hits++;
    return { status: 'hit', value: entry.value as T, age };
  }

  async set<T = unknown>(key: string, value: T, options: CacheSetOptions): Promise<void> {
    // Evict if at capacity
    while (this.cache.size >= this.maxEntries) {
      this.evictLRU();
    }

    const entry: CacheEntry<T> = {
      value,
      createdAt: Date.now(),
      ttlMs: options.ttlMs,
      staleWhileRevalidateMs: options.staleWhileRevalidateMs,
    };

    const existed = this.cache.has(key);
    this.cache.set(key, entry as CacheEntry);

    if (existed) {
      this.touchAccessOrder(key);
    } else {
      this.accessOrder.push(key);
    }
  }

  async delete(key: string): Promise<boolean> {
    const existed = this.cache.delete(key);
    if (existed) {
      this.removeFromAccessOrder(key);
    }
    return existed;
  }

  async deletePattern(pattern: string): Promise<number> {
    const regex = new RegExp('^' + pattern.replace(/\*/g, '.*') + '$');
    let count = 0;

    for (const key of this.cache.keys()) {
      if (regex.test(key)) {
        this.cache.delete(key);
        this.removeFromAccessOrder(key);
        count++;
      }
    }

    return count;
  }

  async clear(): Promise<void> {
    this.cache.clear();
    this.accessOrder = [];
  }

  async has(key: string): Promise<boolean> {
    return this.cache.has(key);
  }

  getStats(): CacheStats {
    const totalQueries = this.hits + this.misses + this.staleHits;
    const hitRate = totalQueries > 0 ? (this.hits + this.staleHits) / totalQueries : 0;
    const avgCacheAge = this.ageCount > 0 ? Math.round(this.totalAgeMs / this.ageCount) : 0;

    // Rough memory estimate: ~200 bytes overhead per entry + value size
    // This is a very rough estimate for monitoring purposes
    let memoryBytes = 0;
    for (const [key, entry] of this.cache.entries()) {
      memoryBytes += key.length * 2; // ~2 bytes per char
      memoryBytes += 200; // overhead
      try {
        memoryBytes += JSON.stringify(entry.value).length * 2;
      } catch {
        memoryBytes += 1000; // fallback estimate
      }
    }

    return {
      hits: this.hits,
      misses: this.misses,
      staleHits: this.staleHits,
      bypassed: this.bypassed,
      hitRate,
      totalQueries,
      avgCacheAge,
      entryCount: this.cache.size,
      memoryBytes,
    };
  }

  resetStats(): void {
    this.hits = 0;
    this.misses = 0;
    this.staleHits = 0;
    this.bypassed = 0;
    this.totalAgeMs = 0;
    this.ageCount = 0;
  }

  /**
   * Record a bypass (called externally when cache is skipped).
   */
  recordBypass(): void {
    this.bypassed++;
  }

  async close(): Promise<void> {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
    }
    this.cache.clear();
    this.accessOrder = [];
  }

  private evictLRU(): void {
    if (this.accessOrder.length === 0) return;

    const key = this.accessOrder.shift()!;
    this.cache.delete(key);
  }

  private touchAccessOrder(key: string): void {
    const idx = this.accessOrder.indexOf(key);
    if (idx !== -1) {
      this.accessOrder.splice(idx, 1);
    }
    this.accessOrder.push(key);
  }

  private removeFromAccessOrder(key: string): void {
    const idx = this.accessOrder.indexOf(key);
    if (idx !== -1) {
      this.accessOrder.splice(idx, 1);
    }
  }

  private cleanup(): void {
    const now = Date.now();
    const keysToDelete: string[] = [];

    for (const [key, entry] of this.cache.entries()) {
      const age = now - entry.createdAt;
      const maxAge = entry.ttlMs + (entry.staleWhileRevalidateMs ?? 0);
      if (age > maxAge) {
        keysToDelete.push(key);
      }
    }

    for (const key of keysToDelete) {
      this.cache.delete(key);
      this.removeFromAccessOrder(key);
    }
  }
}

/**
 * Create an in-memory cache store.
 */
export function createMemoryCacheStore(options?: MemoryStoreOptions): MemoryCacheStore {
  return new MemoryCacheStore(options);
}
