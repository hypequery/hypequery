import { defaultSerialize, defaultDeserialize } from './serialization.js';
const DEFAULT_CACHE_OPTIONS = {
    mode: 'no-store',
    ttlMs: 0,
    staleTtlMs: 0,
    staleIfError: false,
    dedupe: true
};
export function createCacheStats() {
    return { hits: 0, misses: 0, staleHits: 0, revalidations: 0 };
}
function uniqueTags(left, right) {
    const combined = [...(left || []), ...(right || [])];
    if (!combined.length)
        return undefined;
    return Array.from(new Set(combined));
}
export function mergeCacheOptions(...candidates) {
    return candidates.reduce((acc, candidate) => {
        if (!candidate)
            return acc;
        const next = { ...acc };
        for (const [key, value] of Object.entries(candidate)) {
            if (key === 'tags') {
                next.tags = uniqueTags(next.tags, value);
                continue;
            }
            if (value !== undefined) {
                next[key] = value;
            }
        }
        return next;
    }, { ...DEFAULT_CACHE_OPTIONS });
}
export function buildRuntimeContext(config) {
    return {
        provider: config.provider,
        defaults: { ...config.defaults },
        namespace: config.namespace,
        versionTag: config.versionTag,
        serialize: config.serialize,
        deserialize: config.deserialize,
        inFlight: new Map(),
        stats: createCacheStats(),
        parsedValues: new Map()
    };
}
export function resolveCacheConfig(config, fallbackNamespace) {
    const defaults = mergeCacheOptions(config);
    return {
        namespace: config?.namespace || fallbackNamespace,
        versionTag: config?.versionTag || 'v1',
        provider: config?.provider,
        defaults,
        serialize: config?.serialize || ((value) => defaultSerialize(value)),
        deserialize: config?.deserialize || ((raw) => defaultDeserialize(raw))
    };
}
