import { MemoryCacheProvider, type CacheProvider, type CacheEntry } from '@hypequery/clickhouse';

export function createMemoryCache() {
  const maxEntries = Number(process.env.NEXT_PUBLIC_CACHE_MAX_ENTRIES ?? 500);
  const maxBytes = Number(process.env.NEXT_PUBLIC_CACHE_MAX_BYTES ?? 50 * 1024 * 1024);
  console.info(
    `[cache] Initializing in-memory cache (maxEntries=${maxEntries}, maxBytes=${Math.round(maxBytes / 1024 / 1024)}MB)`
  );
  return new MemoryCacheProvider({ maxEntries, maxBytes });
}

export class UpstashRedisCache implements CacheProvider<string> {
  constructor(private baseUrl: string, private token: string) {}

  private async request<T>(path: string, body: unknown): Promise<T> {
    const res = await fetch(`${this.baseUrl}/${path}`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      throw new Error(`Upstash request failed: ${res.status} ${res.statusText}`);
    }

    const json = await res.json();
    return json.result;
  }

  async get(key: string): Promise<CacheEntry | null> {
    const result = await this.request<string | null>('get', { key });
    return result ? (JSON.parse(result) as CacheEntry) : null;
  }

  async set(key: string, entry: CacheEntry): Promise<void> {
    const payload = JSON.stringify(entry);
    await this.request('set', {
      key,
      value: payload,
      px: entry.cacheTimeMs || entry.ttlMs,
    });
  }

  async delete(key: string): Promise<void> {
    await this.request('del', { key });
  }
}

export function createRedisCacheFromEnv() {
  const url = process.env.NEXT_PUBLIC_UPSTASH_REDIS_REST_URL;
  const token = process.env.NEXT_PUBLIC_UPSTASH_REDIS_REST_TOKEN;

  if (!url || !token) {
    return undefined;
  }

  console.info('[cache] Using Upstash Redis cache provider from environment variables');
  return new UpstashRedisCache(url, token);
}
