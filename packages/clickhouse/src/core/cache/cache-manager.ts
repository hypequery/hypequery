import type { QueryBuilder, ExecuteOptions } from '../query-builder.js';
import type { AnyBuilderState, SchemaDefinition } from '../types/builder-state.js';
import type { CacheEntry, CacheOptions, CacheStatus } from './types.js';
import { computeCacheKey } from './key.js';
import { mergeCacheOptions } from './runtime-context.js';
import { logger } from '../utils/logger.js';
import { substituteParameters } from '../utils.js';

function isCacheable(options: CacheOptions): boolean {
  const ttl = options.ttlMs ?? 0;
  const stale = options.staleTtlMs ?? 0;
  return ttl > 0 || stale > 0;
}

function deriveTags<Schema extends SchemaDefinition<Schema>, State extends AnyBuilderState>(builder: QueryBuilder<Schema, State>): string[] {
  const tags = new Set<string>();
  tags.add(builder.getTableName());
  const joins = builder.getConfig().joins || [];
  joins.forEach(join => tags.add(join.table));
  return Array.from(tags);
}

interface CacheHitLogOptions {
  sql: string;
  parameters: unknown[];
  status: CacheStatus;
  cacheKey: string;
  options: CacheOptions;
  rowCount: number;
  ageMs?: number;
  queryId?: string;
}

async function logCacheHit({
  sql,
  parameters,
  status,
  cacheKey,
  options,
  rowCount,
  ageMs,
  queryId
}: CacheHitLogOptions): Promise<void> {
  const finalSQL = substituteParameters(sql, parameters);
  const timestamp = Date.now();
  logger.logQuery({
    query: finalSQL,
    parameters,
    startTime: timestamp,
    endTime: timestamp,
    duration: 0,
    status: 'completed',
    rowCount,
    queryId,
    cacheStatus: status,
    cacheKey,
    cacheMode: options.mode,
    cacheAgeMs: ageMs,
    cacheRowCount: rowCount
  });
}

export async function executeWithCache<
  Schema extends SchemaDefinition<Schema>,
  State extends AnyBuilderState
>(
  builder: QueryBuilder<Schema, State>,
  options?: ExecuteOptions
): Promise<State['output'][]> {
  const runtime = builder.getRuntimeContext();
  const provider = runtime.provider;
  const normalizedExecuteCache = options?.cache === false
    ? { mode: 'no-store' as const, ttlMs: 0, staleTtlMs: 0, cacheTimeMs: 0 }
    : options?.cache;
  const mergedOptions = mergeCacheOptions(runtime.defaults, builder.getCacheOptions(), normalizedExecuteCache);
  const mode = mergedOptions.mode ?? 'no-store';

  if (!provider || mode === 'no-store' || !isCacheable(mergedOptions)) {
    if (provider) {
      runtime.stats.misses += 1;
    }
    return builder.getExecutor().execute({
      queryId: options?.queryId,
      logContext: { cacheStatus: 'bypass', cacheMode: mode }
    });
  }

  const activeProvider = provider;

  const { sql, parameters } = builder.toSQLWithParams();
  const tableName = builder.getTableName();
  const namespace = mergedOptions.namespace || runtime.namespace;
  const key = mergedOptions.key || computeCacheKey({
    namespace,
    sql,
    parameters,
    settings: builder.getConfig().settings ? { settings: builder.getConfig().settings } : undefined,
    version: runtime.versionTag,
    tableName
  });

  const entry = await activeProvider.get(key);
  if (!entry) {
    runtime.parsedValues.delete(key);
  }
  const now = Date.now();
  const fresh = entry ? now < entry.createdAt + entry.ttlMs : false;
  const staleAcceptable = entry ? now < entry.createdAt + entry.ttlMs + entry.staleTtlMs : false;
  const deserialize = mergedOptions.deserialize || runtime.deserialize;
  const serialize = mergedOptions.serialize || runtime.serialize;

  const respondFromCache = async (cacheEntry: CacheEntry, status: CacheStatus): Promise<State['output'][]> => {
    const memoized = runtime.parsedValues.get(key);
    let rows: State['output'][];
    if (memoized && memoized.createdAt === cacheEntry.createdAt) {
      rows = memoized.rows as State['output'][];
    } else {
      rows = await deserialize(cacheEntry.value) as State['output'][];
      runtime.parsedValues.set(key, { createdAt: cacheEntry.createdAt, rows, tags: cacheEntry.tags });
    }
    const cacheAge = now - cacheEntry.createdAt;
    if (status === 'hit') {
      runtime.stats.hits += 1;
    } else if (status === 'stale-hit') {
      runtime.stats.staleHits += 1;
    }
    await logCacheHit({
      sql,
      parameters,
      status,
      cacheKey: key,
      options: mergedOptions,
      rowCount: cacheEntry.rowCount ?? rows.length,
      ageMs: cacheAge,
      queryId: options?.queryId
    });
    return rows;
  };

  if (mode === 'cache-first') {
    if (entry && fresh) {
      return respondFromCache(entry, 'hit');
    }
    runtime.stats.misses += 1;
    return fetchAndStore('miss');
  }

  if (mode === 'stale-while-revalidate') {
    if (entry && fresh) {
      return respondFromCache(entry, 'hit');
    }
    if (entry && staleAcceptable) {
      scheduleRevalidation();
      return respondFromCache(entry, 'stale-hit');
    }
    runtime.stats.misses += 1;
    return fetchAndStore('miss');
  }

  if (mode === 'network-first') {
    try {
      runtime.stats.misses += 1;
      return await fetchAndStore('miss');
    } catch (error) {
      if (mergedOptions.staleIfError && entry && staleAcceptable) {
        return respondFromCache(entry, 'stale-hit');
      }
      throw error;
    }
  }

  runtime.stats.misses += 1;
  return builder.getExecutor().execute({
    queryId: options?.queryId,
    logContext: { cacheStatus: 'bypass', cacheMode: mode }
  });

  async function fetchAndStore(cacheStatus: CacheStatus): Promise<State['output'][]> {
    if (mergedOptions.dedupe !== false && runtime.inFlight.has(key)) {
      return runtime.inFlight.get(key)! as Promise<State['output'][]>;
    }

    const promise = (async () => {
      const rows = await builder.getExecutor().execute({
        queryId: options?.queryId,
        logContext: { cacheStatus, cacheKey: key, cacheMode: mode }
      });

      const encoded = await serialize(rows);
      const ttlMs = mergedOptions.ttlMs ?? 0;
      const staleTtlMs = mergedOptions.staleTtlMs ?? 0;
      const cacheTimeMs = mergedOptions.cacheTimeMs ?? ttlMs + staleTtlMs;
      const derivedTags = deriveTags(builder);
      const tagSet = new Set([...(mergedOptions.tags || []), ...derivedTags]);
      const newEntry: CacheEntry = {
        value: encoded.payload,
        createdAt: Date.now(),
        ttlMs,
        staleTtlMs,
        cacheTimeMs,
        tags: Array.from(tagSet),
        rowCount: rows.length,
        byteSize: encoded.byteSize,
        sqlFingerprint: key
      };

      await activeProvider.set(key, newEntry);
      runtime.parsedValues.set(key, { createdAt: newEntry.createdAt, rows, tags: newEntry.tags });
      return rows;
    })();

    if (mergedOptions.dedupe !== false) {
      runtime.inFlight.set(key, promise);
      promise.finally(() => runtime.inFlight.delete(key));
    }

    return promise;
  }

  function scheduleRevalidation() {
    runtime.stats.revalidations += 1;
    fetchAndStore('revalidate').catch(() => undefined);
  }
}
