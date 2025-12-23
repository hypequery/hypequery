export type HypeQueryCacheMode =
  | 'no-store'
  | 'cache-first'
  | 'network-first'
  | 'stale-while-revalidate';

export interface CacheSerializationResult {
  payload: string | Uint8Array;
  byteSize: number;
}

export type CacheSerializeFn = (value: unknown) => CacheSerializationResult | Promise<CacheSerializationResult>;
export type CacheDeserializeFn<T = unknown> = (raw: string | Uint8Array) => T | Promise<T>;

export type CacheStatus = 'hit' | 'miss' | 'stale-hit' | 'revalidate' | 'bypass';

export interface CacheLogMetadata {
  cacheStatus?: CacheStatus;
  cacheKey?: string;
  cacheMode?: HypeQueryCacheMode;
  cacheAgeMs?: number;
  cacheRowCount?: number;
}

export interface CacheOptions {
  mode?: HypeQueryCacheMode;
  ttlMs?: number;
  staleTtlMs?: number;
  cacheTimeMs?: number;
  staleIfError?: boolean;
  dedupe?: boolean;
  tags?: string[];
  key?: string;
  namespace?: string;
  serialize?: CacheSerializeFn;
  deserialize?: CacheDeserializeFn;
}

export interface CacheConfig extends CacheOptions {
  provider?: CacheProvider;
  versionTag?: string;
}

export interface CacheEntry<TSerialized = string | Uint8Array> {
  value: TSerialized;
  createdAt: number;
  ttlMs: number;
  staleTtlMs: number;
  cacheTimeMs: number;
  tags?: string[];
  rowCount?: number;
  byteSize?: number;
  sqlFingerprint?: string;
  metadata?: Record<string, unknown>;
  status?: 'pending' | 'fulfilled' | 'revalidating' | 'error';
}

export interface CacheProvider<TSerialized = string | Uint8Array> {
  get(key: string): Promise<CacheEntry<TSerialized> | null>;
  set(key: string, entry: CacheEntry<TSerialized>): Promise<void>;
  delete(key: string): Promise<void>;
  deleteByTag?(namespace: string, tag: string): Promise<void>;
  clearNamespace?(namespace: string): Promise<void>;
}

export interface CacheStats {
  hits: number;
  misses: number;
  staleHits: number;
  revalidations: number;
}
