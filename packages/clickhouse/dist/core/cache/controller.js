import { logger } from '../utils/logger.js';
export class CacheController {
    context;
    constructor(context) {
        this.context = context;
    }
    async invalidateKey(key) {
        this.context.parsedValues.delete(key);
        if (!this.context.provider)
            return;
        await this.context.provider.delete(key);
    }
    async invalidateTags(tags) {
        if (!tags.length)
            return;
        const deleteByTag = this.context.provider?.deleteByTag;
        if (!deleteByTag) {
            logger.warn('Cache provider does not support tag invalidation. Tags ignored.', {
                namespace: this.context.namespace,
                tags
            });
            this.removeParsedValuesByTags(tags);
            return;
        }
        await Promise.all(tags.map(tag => deleteByTag.call(this.context.provider, this.context.namespace, tag)));
        this.removeParsedValuesByTags(tags);
    }
    async clear() {
        if (this.context.provider?.clearNamespace) {
            await this.context.provider.clearNamespace(this.context.namespace);
        }
        this.context.parsedValues.clear();
    }
    async warm(queries) {
        if (!queries.length)
            return;
        await Promise.all(queries.map(query => query()));
    }
    getStats() {
        const stats = { ...this.context.stats };
        const total = stats.hits + stats.misses + stats.staleHits;
        const hitRate = total > 0 ? (stats.hits + stats.staleHits) / total : 0;
        return { ...stats, hitRate };
    }
    removeParsedValuesByTags(tags) {
        if (!tags.length)
            return;
        const target = new Set(tags);
        for (const [key, record] of this.context.parsedValues) {
            if (!record.tags?.length)
                continue;
            const intersects = record.tags.some(tag => target.has(tag));
            if (intersects) {
                this.context.parsedValues.delete(key);
            }
        }
    }
}
