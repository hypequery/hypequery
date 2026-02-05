import type { CacheEntry, CacheProvider } from '../types.js';
export declare class NoopCacheProvider implements CacheProvider {
    get(_key: string): Promise<CacheEntry | null>;
    set(_key: string, _entry: CacheEntry): Promise<void>;
    delete(_key: string): Promise<void>;
}
//# sourceMappingURL=noop.d.ts.map