function extractNamespace(key) {
    const parts = key.split(':');
    if (parts.length < 4) {
        return 'default';
    }
    if (parts.length === 4) {
        return parts[2];
    }
    // Namespace may contain additional ':' (e.g., protocol prefixes); rejoin everything
    // between the version segment and the trailing table/digest tokens.
    const namespace = parts.slice(2, -2).join(':');
    return namespace || 'default';
}
export class MemoryCacheProvider {
    entries = new Map();
    tagIndex = new Map();
    currentBytes = 0;
    maxEntries;
    maxBytes;
    cleanupIntervalMs;
    cleanupTimer;
    constructor(options = {}) {
        this.maxEntries = options.maxEntries ?? 1000;
        this.maxBytes = options.maxBytes ?? 50 * 1024 * 1024;
        this.cleanupIntervalMs = options.cleanupIntervalMs ?? 30_000;
        if (this.cleanupIntervalMs > 0 && typeof setInterval !== 'undefined') {
            this.cleanupTimer = setInterval(() => this.cleanup(), this.cleanupIntervalMs);
            const timer = this.cleanupTimer;
            if (typeof timer.unref === 'function') {
                timer.unref();
            }
        }
    }
    dispose() {
        if (this.cleanupTimer) {
            clearInterval(this.cleanupTimer);
            this.cleanupTimer = undefined;
        }
    }
    async get(key) {
        this.cleanup();
        const entry = this.entries.get(key);
        if (!entry)
            return null;
        if (entry.cacheTimeMs > 0 && Date.now() > entry.createdAt + entry.cacheTimeMs) {
            await this.delete(key);
            return null;
        }
        this.touch(key, entry);
        return entry;
    }
    async set(key, entry) {
        const existing = this.entries.get(key);
        if (existing) {
            this.currentBytes -= existing.byteSize || 0;
            this.unindexTags(key, existing.tags);
        }
        this.entries.set(key, entry);
        this.currentBytes += entry.byteSize || 0;
        this.indexTags(key, entry.tags);
        this.enforceLimits();
    }
    async delete(key) {
        const entry = this.entries.get(key);
        if (!entry)
            return;
        this.entries.delete(key);
        this.currentBytes -= entry.byteSize || 0;
        this.unindexTags(key, entry.tags);
    }
    async deleteByTag(namespace, tag) {
        const indexKey = this.getTagIndexKey(namespace, tag);
        const keys = this.tagIndex.get(indexKey);
        if (!keys)
            return;
        for (const key of keys) {
            await this.delete(key);
        }
        this.tagIndex.delete(indexKey);
    }
    async clearNamespace(namespace) {
        const keys = Array.from(this.entries.keys());
        await Promise.all(keys.map(key => {
            if (extractNamespace(key) === namespace) {
                return this.delete(key);
            }
            return Promise.resolve();
        }));
    }
    touch(key, entry) {
        this.entries.delete(key);
        this.entries.set(key, entry);
    }
    enforceLimits() {
        while (this.entries.size > this.maxEntries || this.currentBytes > this.maxBytes) {
            const oldestKey = this.entries.keys().next().value;
            if (!oldestKey)
                break;
            this.delete(oldestKey);
        }
    }
    cleanup() {
        if (!this.entries.size)
            return;
        const now = Date.now();
        for (const [key, entry] of this.entries) {
            if (entry.cacheTimeMs > 0 && now > entry.createdAt + entry.cacheTimeMs) {
                this.delete(key);
            }
        }
        this.cleanupTagIndex();
    }
    indexTags(key, tags) {
        if (!tags || !tags.length)
            return;
        const namespace = extractNamespace(key);
        tags.forEach(tag => {
            const indexKey = this.getTagIndexKey(namespace, tag);
            if (!this.tagIndex.has(indexKey)) {
                this.tagIndex.set(indexKey, new Set());
            }
            this.tagIndex.get(indexKey).add(key);
        });
    }
    unindexTags(key, tags) {
        if (!tags || !tags.length)
            return;
        const namespace = extractNamespace(key);
        tags.forEach(tag => {
            const indexKey = this.getTagIndexKey(namespace, tag);
            const bucket = this.tagIndex.get(indexKey);
            if (!bucket)
                return;
            bucket.delete(key);
            if (!bucket.size) {
                this.tagIndex.delete(indexKey);
            }
        });
    }
    getTagIndexKey(namespace, tag) {
        return `${namespace}:${tag}`;
    }
    cleanupTagIndex() {
        for (const [indexKey, keys] of this.tagIndex) {
            for (const key of keys) {
                if (!this.entries.has(key)) {
                    keys.delete(key);
                }
            }
            if (!keys.size) {
                this.tagIndex.delete(indexKey);
            }
        }
    }
}
export { MemoryCacheProvider as MemoryLRUCacheProvider };
