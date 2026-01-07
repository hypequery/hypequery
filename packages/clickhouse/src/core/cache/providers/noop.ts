import type { CacheEntry, CacheProvider } from '../types.js';

export class NoopCacheProvider implements CacheProvider {
  async get(_key: string): Promise<CacheEntry | null> {
    return null;
  }

  async set(_key: string, _entry: CacheEntry): Promise<void> {
    return;
  }

  async delete(_key: string): Promise<void> {
    return;
  }
}
