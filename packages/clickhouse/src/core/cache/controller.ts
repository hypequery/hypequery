import type { QueryRuntimeContext } from './runtime-context.js';

export class CacheController {
  constructor(private context: QueryRuntimeContext) { }

  async invalidateKey(key: string): Promise<void> {
    if (!this.context.provider) return;
    await this.context.provider.delete(key);
  }

  async invalidateTags(tags: string[]): Promise<void> {
    const deleteByTag = this.context.provider?.deleteByTag;
    if (!deleteByTag) return;
    await Promise.all(tags.map(tag => deleteByTag.call(this.context.provider, this.context.namespace, tag)));
  }

  async clear(): Promise<void> {
    if (this.context.provider?.clearNamespace) {
      await this.context.provider.clearNamespace(this.context.namespace);
    }
  }

  getStats() {
    return { ...this.context.stats };
  }
}
