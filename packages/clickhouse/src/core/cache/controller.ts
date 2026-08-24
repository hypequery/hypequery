import type { QueryRuntimeContext } from './runtime-context.js';
import type { CacheStats } from './types.js';
import { logger } from '../utils/logger.js';

export class CacheController {
  constructor(private context: QueryRuntimeContext) { }

  async invalidateKey(key: string): Promise<void> {
    const provider = this.context.provider;
    if (provider) {
      await this.context.mutations.invalidate(
        scope => scope.key === key,
        () => provider.delete(key)
      );
    }
    this.context.parsedValues.delete(key);
  }

  async invalidateTags(tags: string[]): Promise<void> {
    if (!tags.length) return;
    const provider = this.context.provider;
    const deleteByTag = provider?.deleteByTag;
    if (!deleteByTag) {
      logger.warn('Cache provider does not support tag invalidation. Tags ignored.', {
        namespace: this.context.namespace,
        tags
      });
      this.removeParsedValuesByTags(tags);
      return;
    }
    const target = new Set(tags);
    await this.context.mutations.invalidate(
      scope => scope.namespace === this.context.namespace
        && scope.tags.some(tag => target.has(tag)),
      async () => {
        await Promise.all(tags.map(tag => deleteByTag.call(provider, this.context.namespace, tag)));
      }
    );
    this.removeParsedValuesByTags(tags);
  }

  async clear(): Promise<void> {
    const provider = this.context.provider;
    const clearNamespace = provider?.clearNamespace;
    if (clearNamespace) {
      await this.context.mutations.invalidate(
        scope => scope.namespace === this.context.namespace,
        () => clearNamespace.call(provider, this.context.namespace)
      );
    }
    this.context.parsedValues.clear();
  }

  async warm(queries: Array<() => Promise<unknown>>): Promise<void> {
    if (!queries.length) return;
    await Promise.all(queries.map(query => query()));
  }

  getStats(): CacheStats & { hitRate: number } {
    const stats = { ...this.context.stats };
    const total = stats.hits + stats.misses + stats.staleHits;
    const hitRate = total > 0 ? (stats.hits + stats.staleHits) / total : 0;
    return { ...stats, hitRate };
  }

  private removeParsedValuesByTags(tags: string[]) {
    if (!tags.length) return;
    const target = new Set(tags);
    for (const [key, record] of this.context.parsedValues) {
      if (!record.tags?.length) continue;
      const intersects = record.tags.some(tag => target.has(tag));
      if (intersects) {
        this.context.parsedValues.delete(key);
      }
    }
  }
}
