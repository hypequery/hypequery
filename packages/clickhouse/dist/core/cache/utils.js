import { CacheController } from './controller.js';
import { buildRuntimeContext, resolveCacheConfig } from './runtime-context.js';
import { MemoryCacheProvider } from './providers/memory-lru.js';
export function mergeCacheOptionsPartial(target, update) {
    const result = { ...(target || {}) };
    for (const [key, value] of Object.entries(update)) {
        if (key === 'tags') {
            const existing = result.tags || [];
            const incoming = value || [];
            if (incoming.length) {
                result.tags = Array.from(new Set([...existing, ...incoming]));
            }
            continue;
        }
        if (value !== undefined) {
            result[key] = value;
        }
    }
    return result;
}
export function initializeCacheRuntime(cacheConfig, namespace) {
    const provider = cacheConfig?.provider ?? (cacheConfig ? new MemoryCacheProvider() : undefined);
    const mergedCacheConfig = cacheConfig
        ? { ...cacheConfig, namespace, provider }
        : { namespace, provider };
    const runtimeConfig = resolveCacheConfig(mergedCacheConfig, namespace);
    const runtime = buildRuntimeContext(runtimeConfig);
    const cacheController = new CacheController(runtime);
    return { runtime, cacheController };
}
