import { MemoryCacheProvider } from '@hypequery/clickhouse';

export function createMemoryCache() {
  const maxEntries = Number(process.env.NEXT_PUBLIC_CACHE_MAX_ENTRIES ?? 500);
  const maxBytes = Number(process.env.NEXT_PUBLIC_CACHE_MAX_BYTES ?? 50 * 1024 * 1024);
  console.info(
    `[cache] Initializing in-memory cache (maxEntries=${maxEntries}, maxBytes=${Math.round(maxBytes / 1024 / 1024)}MB)`
  );
  return new MemoryCacheProvider({ maxEntries, maxBytes });
}
