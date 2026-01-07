import type { CacheConfig, CacheOptions } from './types.js';
import type { QueryRuntimeContext } from './runtime-context.js';
import { CacheController } from './controller.js';
import { buildRuntimeContext, resolveCacheConfig } from './runtime-context.js';
import { MemoryCacheProvider } from './providers/memory-lru.js';

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

export function initializeCacheRuntime(
  cacheConfig: CacheConfig | undefined,
  namespace: string
): { runtime: QueryRuntimeContext; cacheController: CacheController } {
  const provider = cacheConfig?.provider ?? (cacheConfig ? new MemoryCacheProvider() : undefined);
  const mergedCacheConfig = cacheConfig
    ? { ...cacheConfig, namespace, provider }
    : { namespace, provider } as CacheConfig;
  const runtimeConfig = resolveCacheConfig(mergedCacheConfig, namespace);
  const runtime = buildRuntimeContext(runtimeConfig);
  const cacheController = new CacheController(runtime);
  return { runtime, cacheController };
}
