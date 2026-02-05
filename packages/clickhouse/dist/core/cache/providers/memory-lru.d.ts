import type { CacheEntry, CacheProvider } from '../types.js';
export interface MemoryLRUCacheOptions {
    maxEntries?: number;
    maxBytes?: number;
    cleanupIntervalMs?: number;
}
export declare class MemoryCacheProvider implements CacheProvider {
    private entries;
    private tagIndex;
    private currentBytes;
    private maxEntries;
    private maxBytes;
    private cleanupIntervalMs;
    private cleanupTimer?;
    constructor(options?: MemoryLRUCacheOptions);
    dispose(): void;
    get(key: string): Promise<CacheEntry | null>;
    set(key: string, entry: CacheEntry): Promise<void>;
    delete(key: string): Promise<void>;
    deleteByTag(namespace: string, tag: string): Promise<void>;
    clearNamespace(namespace: string): Promise<void>;
    private touch;
    private enforceLimits;
    private cleanup;
    private indexTags;
    private unindexTags;
    private getTagIndexKey;
    private cleanupTagIndex;
}
export { MemoryCacheProvider as MemoryLRUCacheProvider };
//# sourceMappingURL=memory-lru.d.ts.map