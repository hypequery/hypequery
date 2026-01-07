import type { CacheOptions } from './types.js';

export function mergeCacheOptionsPartial(target: CacheOptions | undefined, update: CacheOptions): CacheOptions {
  const result: CacheOptions = { ...(target || {}) };
  for (const [key, value] of Object.entries(update) as [keyof CacheOptions, unknown][]) {
    if (key === 'tags') {
      const existing = result.tags || [];
      const incoming = (value as string[]) || [];
      if (incoming.length) {
        result.tags = Array.from(new Set([...existing, ...incoming]));
      }
      continue;
    }
    if (value !== undefined) {
      (result as Record<string, unknown>)[key as string] = value;
    }
  }
  return result;
}
