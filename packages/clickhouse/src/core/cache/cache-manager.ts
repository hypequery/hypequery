import type { QueryBuilder, ExecuteOptions } from '../query-builder.js';
import type { AnyBuilderState, SchemaDefinition } from '../types/builder-state.js';
import type { CacheEntry, CacheOptions, CacheStatus } from './types.js';
import { computeCacheKey } from './key.js';
import { mergeCacheOptions } from './runtime-context.js';
import type { SharedFetch } from './runtime-context.js';
import { logger } from '../utils/logger.js';

function abortError(signal: AbortSignal): unknown {
  return signal.reason ?? new Error('The query was aborted.');
}

function joinSharedFetch<T>(shared: SharedFetch, abortSignal?: AbortSignal): Promise<T> {
  if (!abortSignal) {
    shared.pinnedWaiters += 1;
    return shared.promise as Promise<T>;
  }
  if (abortSignal.aborted) {
    return Promise.reject(abortError(abortSignal));
  }

  shared.abortableWaiters += 1;
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => {
      shared.abortableWaiters -= 1;
      if (shared.abortableWaiters === 0 && shared.pinnedWaiters === 0) {
        shared.controller.abort(abortSignal.reason);
      }
      reject(abortError(abortSignal));
    };
    abortSignal.addEventListener('abort', onAbort, { once: true });
    shared.promise.then(
      value => {
        abortSignal.removeEventListener('abort', onAbort);
        resolve(value as T);
      },
      error => {
        abortSignal.removeEventListener('abort', onAbort);
        reject(error);
      }
    );
  });
}

function isCacheable(options: CacheOptions): boolean {
  const ttl = options.ttlMs ?? 0;
  const stale = options.staleTtlMs ?? 0;
  return ttl > 0 || stale > 0;
}

function deriveTags<Schema extends SchemaDefinition<Schema>, State extends AnyBuilderState>(builder: QueryBuilder<Schema, State>): string[] {
  const queryNode = builder.toQueryNode();
  const tags = new Set<string>();
  tags.add(queryNode.from?.kind === 'table' ? queryNode.from.name : builder.getTableName());
  const joins = queryNode.joins || [];
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
  const timestamp = Date.now();
  logger.logQuery({
    query: sql,
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
  options?.abortSignal?.throwIfAborted();

  const runtime = builder.getRuntimeContext();
  const provider = runtime.provider;
  const normalizedExecuteCache = options?.cache === false
    ? { mode: 'no-store' as const }
    : options?.cache;
  const mergedOptions = mergeCacheOptions(runtime.defaults, builder.getCacheOptions(), normalizedExecuteCache);
  const mode = mergedOptions.mode ?? 'no-store';

  if (!provider || mode === 'no-store' || !isCacheable(mergedOptions)) {
    return runWithoutCache('bypass');
  }

  const activeProvider = provider;

  const { sql, parameters } = builder.toSQLWithParams();
  const tableName = builder.getTableName();
  const namespace = mergedOptions.namespace || runtime.namespace;
  const queryNode = builder.toQueryNode();
  const key = mergedOptions.key || computeCacheKey({
    namespace,
    sql,
    parameters,
    settings: queryNode.settings,
    version: runtime.versionTag,
    tableName
  });

  const entry = await activeProvider.get(key);
  if (!entry) {
    runtime.parsedValues.delete(key);
  }
  const fresh = entry ? Date.now() < entry.createdAt + entry.ttlMs : false;
  const staleAcceptable = entry ? Date.now() < entry.createdAt + entry.ttlMs + entry.staleTtlMs : false;
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
    const cacheAge = Date.now() - cacheEntry.createdAt;
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
    return fetchAndStore('miss', options?.abortSignal);
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
    return fetchAndStore('miss', options?.abortSignal);
  }

  if (mode === 'network-first') {
    try {
      runtime.stats.misses += 1;
      return await fetchAndStore('miss', options?.abortSignal);
    } catch (error) {
      // An abort is a caller decision, not a network failure staleIfError should mask.
      if (options?.abortSignal?.aborted) {
        throw error;
      }
      if (mergedOptions.staleIfError && entry && staleAcceptable) {
        return respondFromCache(entry, 'stale-hit');
      }
      throw error;
    }
  }

  return runWithoutCache('bypass');

  async function fetchAndStore(cacheStatus: CacheStatus, abortSignal?: AbortSignal): Promise<State['output'][]> {
    // A pre-aborted creator would otherwise start a zero-waiter fetch nobody can cancel.
    abortSignal?.throwIfAborted();
    if (mergedOptions.dedupe === false) {
      return runFetch(cacheStatus, abortSignal);
    }

    // A cancelled fetch lingers in the map until its promise settles.
    let shared = runtime.inFlight.get(key);
    if (!shared || shared.controller.signal.aborted) {
      const controller = new AbortController();
      const created: SharedFetch = {
        promise: runFetch(cacheStatus, controller.signal),
        controller,
        abortableWaiters: 0,
        pinnedWaiters: 0
      };
      runtime.inFlight.set(key, created);
      created.promise
        .catch(() => undefined)
        .finally(() => {
          if (runtime.inFlight.get(key) === created) {
            runtime.inFlight.delete(key);
          }
        });
      shared = created;
    }

    return joinSharedFetch<State['output'][]>(shared, abortSignal);
  }

  function runFetch(cacheStatus: CacheStatus, abortSignal?: AbortSignal): Promise<State['output'][]> {
    return (async () => {
      const rows = await builder.getExecutor().execute({
        queryId: options?.queryId,
        abortSignal,
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
  }

  function scheduleRevalidation() {
    runtime.stats.revalidations += 1;
    // Background refresh serves later callers, so it must outlive the aborting one.
    fetchAndStore('revalidate').catch(() => undefined);
  }

  function runWithoutCache(cacheStatus: CacheStatus) {
    if (provider) {
      runtime.stats.misses += 1;
    }
    return builder.getExecutor().execute({
      queryId: options?.queryId,
      abortSignal: options?.abortSignal,
      logContext: { cacheStatus, cacheMode: mode }
    });
  }
}
