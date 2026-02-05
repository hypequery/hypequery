import type { CacheConfig, CacheOptions, CacheProvider, CacheSerializeFn, CacheDeserializeFn, CacheStats } from './types.js';
export interface QueryRuntimeContext {
    provider?: CacheProvider;
    defaults: CacheOptions;
    namespace: string;
    versionTag: string;
    serialize: CacheSerializeFn;
    deserialize: CacheDeserializeFn;
    inFlight: Map<string, Promise<unknown>>;
    stats: CacheStats;
    parsedValues: Map<string, ParsedValueEntry>;
}
export interface ParsedValueEntry {
    createdAt: number;
    rows: unknown;
    tags?: string[];
}
export declare function createCacheStats(): CacheStats;
export declare function mergeCacheOptions(...candidates: Array<CacheOptions | undefined>): CacheOptions;
export interface CacheRuntimeConfig {
    namespace: string;
    versionTag: string;
    provider?: CacheProvider;
    defaults: CacheOptions;
    serialize: CacheSerializeFn;
    deserialize: CacheDeserializeFn;
}
export declare function buildRuntimeContext(config: CacheRuntimeConfig): QueryRuntimeContext;
export declare function resolveCacheConfig(config: CacheConfig | undefined, fallbackNamespace: string): CacheRuntimeConfig;
//# sourceMappingURL=runtime-context.d.ts.map