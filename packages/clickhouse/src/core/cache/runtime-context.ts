import type {
  CacheConfig,
  CacheOptions,
  CacheProvider,
  CacheSerializeFn,
  CacheDeserializeFn,
  CacheStats
} from './types.js';
import { defaultSerialize, defaultDeserialize } from './serialization.js';

const DEFAULT_CACHE_OPTIONS: Required<Pick<CacheOptions, 'mode' | 'ttlMs' | 'staleTtlMs' | 'staleIfError' | 'dedupe'>> & Pick<CacheOptions, 'cacheTimeMs'> = {
  mode: 'no-store',
  ttlMs: 0,
  staleTtlMs: 0,
  staleIfError: false,
  dedupe: true
};

export interface QueryRuntimeContext {
  provider?: CacheProvider;
  defaults: CacheOptions;
  namespace: string;
  versionTag: string;
  serialize: CacheSerializeFn;
  deserialize: CacheDeserializeFn;
  inFlight: Map<string, Promise<unknown>>;
  stats: CacheStats;
  parsedValues: Map<string, ParsedValueEntry>;
}

export interface ParsedValueEntry {
  createdAt: number;
  rows: unknown;
  tags?: string[];
}

export function createCacheStats(): CacheStats {
  return { hits: 0, misses: 0, staleHits: 0, revalidations: 0 };
}

function uniqueTags(left?: string[], right?: string[]): string[] | undefined {
  const combined = [...(left || []), ...(right || [])];
  if (!combined.length) return undefined;
  return Array.from(new Set(combined));
}

export function mergeCacheOptions(...candidates: Array<CacheOptions | undefined>): CacheOptions {
  return candidates.reduce<CacheOptions>((acc, candidate) => {
    if (!candidate) return acc;
    const next = { ...acc } as CacheOptions;
    for (const [key, value] of Object.entries(candidate) as [keyof CacheOptions, unknown][]) {
      if (key === 'tags') {
        next.tags = uniqueTags(next.tags, value as string[] | undefined);
        continue;
      }
      if (value !== undefined) {
        (next as Record<string, unknown>)[key as string] = value;
      }
    }
    return next;
  }, { ...DEFAULT_CACHE_OPTIONS });
}

export interface CacheRuntimeConfig {
  namespace: string;
  versionTag: string;
  provider?: CacheProvider;
  defaults: CacheOptions;
  serialize: CacheSerializeFn;
  deserialize: CacheDeserializeFn;
}

export function buildRuntimeContext(config: CacheRuntimeConfig): QueryRuntimeContext {
  return {
    provider: config.provider,
    defaults: { ...config.defaults },
    namespace: config.namespace,
    versionTag: config.versionTag,
    serialize: config.serialize,
    deserialize: config.deserialize,
    inFlight: new Map(),
    stats: createCacheStats(),
    parsedValues: new Map()
  };
}

export function resolveCacheConfig(config: CacheConfig | undefined, fallbackNamespace: string): CacheRuntimeConfig {
  const defaults = mergeCacheOptions(config);
  return {
    namespace: config?.namespace || fallbackNamespace,
    versionTag: config?.versionTag || 'v1',
    provider: config?.provider,
    defaults,
    serialize: config?.serialize || ((value) => defaultSerialize(value)),
    deserialize: config?.deserialize || ((raw) => defaultDeserialize(raw))
  } as CacheRuntimeConfig;
}
