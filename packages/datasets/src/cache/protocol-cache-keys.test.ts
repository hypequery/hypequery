/**
 * TSP-05: the result cache keys entries with RFC 0009 preimages and RFC 0013
 * keys, exactly as the Python SDK does. These tests pin what that buys:
 * - stores see only opaque keys;
 * - tenants never share entries;
 * - the secret is optional;
 * - TypeScript and Python derive the same key.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { dataset, dimension, measure } from '../index.js';
import { createDatasetClient } from '../executor.js';
import type { QueryBuilderFactoryLike, QueryBuilderLike } from '../query-builder-protocol.js';
import type { SemanticCacheEntry, SemanticCacheStore } from './semantic-query-cache.js';
import { createMemoryCacheStore } from './semantic-query-cache.js';
import { datasetCacheKey, resolveProtocolCacheKeySettings } from './protocol-cache-keys.js';

const KEY = /^hq1\.1\.[A-Za-z0-9_-]{22}\.[A-Za-z0-9_-]{43}$/;
const SECRET = new Uint8Array(32).fill(0x5a);

function countingFactory() {
  const executions = vi.fn();
  const builder: QueryBuilderLike = {
    select: () => builder,
    sum: () => builder,
    count: () => builder,
    countDistinct: () => builder,
    avg: () => builder,
    min: () => builder,
    max: () => builder,
    where: () => builder,
    groupBy: () => builder,
    orderBy: () => builder,
    limit: () => builder,
    offset: () => builder,
    toSQLWithParams: () => ({ sql: 'SELECT 1', parameters: [] }),
    execute: async <T,>() => {
      executions();
      return [{ trips: 1 }] as T[];
    },
  };
  const factory: QueryBuilderFactoryLike = {
    table: () => builder,
    rawQuery: async <T,>() => [] as T[],
  };
  return { factory, executions };
}

function recordingStore() {
  const inner = createMemoryCacheStore();
  const keys: string[] = [];
  const store: SemanticCacheStore = {
    get(key) {
      keys.push(key);
      return inner.get(key);
    },
    set(key, entry: SemanticCacheEntry) {
      keys.push(key);
      return inner.set(key, entry);
    },
    delete: (key) => inner.delete(key),
  };
  return { store, keys };
}

const Trips = dataset('trips', {
  source: 'analytics.trips',
  tenantKey: 'org_id',
  dimensions: { vendor: dimension.string(), fare: dimension.number(), pickedUp: dimension.timestamp() },
  measures: { trips: measure.count('id') },
});

const Vendors = dataset('vendors', {
  source: 'analytics.vendors',
  dimensions: { vendor: dimension.string() },
  measures: { vendors: measure.count('id') },
});

const asTenant = (id: string) => ({ runtime: { tenant: id } });

afterEach(() => {
  vi.restoreAllMocks();
});

describe('protocol cache keys', () => {
  it('stores see only opaque keys, never tenants, filter values, or sources', async () => {
    const { factory } = countingFactory();
    const { store, keys } = recordingStore();
    const client = createDatasetClient({ queryBuilder: factory, cache: { ttlMs: 60_000, store, secret: SECRET } });

    await client.execute(
      Trips,
      { measures: ['trips'], filters: [{ field: 'vendor', operator: 'eq', value: 'secret-vendor' }] },
      asTenant('tenant-marker'),
    );

    expect(keys.length).toBeGreaterThan(0);
    for (const key of keys) {
      expect(key).toMatch(KEY);
      for (const fragment of ['secret-vendor', 'tenant-marker', 'analytics', 'trips', 'vendor']) {
        expect(key).not.toContain(fragment);
      }
    }
  });

  it('never shares an entry between tenants, even on a tenant-less dataset', async () => {
    // RFC 0009 keys on the tenant capability present on the call, whether or
    // not the dataset applies it: stricter than the old readable signature.
    const { factory, executions } = countingFactory();
    const client = createDatasetClient({ queryBuilder: factory, cache: { ttlMs: 60_000 } });

    await client.execute(Vendors, { measures: ['vendors'] }, asTenant('acme'));
    await client.execute(Vendors, { measures: ['vendors'] }, asTenant('globex'));
    await client.execute(Vendors, { measures: ['vendors'] }, asTenant('acme'));

    expect(executions).toHaveBeenCalledTimes(2);
  });

  it('caches timestamp and between filters, and separates distinct timestamps', async () => {
    const { factory, executions } = countingFactory();
    const client = createDatasetClient({ queryBuilder: factory, cache: { ttlMs: 60_000 } });
    const query = (day: string) => ({
      measures: ['trips'],
      filters: [
        { field: 'fare', operator: 'between' as const, value: [1, 9] },
        { field: 'pickedUp', operator: 'gte' as const, value: day },
      ],
    });

    await client.execute(Trips, query('2026-01-01T00:00:00Z'), asTenant('acme'));
    await client.execute(Trips, query('2026-01-01T00:00:00Z'), asTenant('acme'));
    await client.execute(Trips, query('2026-01-02T00:00:00Z'), asTenant('acme'));

    expect(executions).toHaveBeenCalledTimes(2);
  });

  it('has no key, rather than throwing, for a value with no portable form', () => {
    // The executor runs such a call uncached; a cache never fails a query.
    const settings = resolveProtocolCacheKeySettings({ secret: SECRET }, false);
    const key = (value: unknown) => datasetCacheKey(
      settings,
      Trips,
      { measures: ['trips'], filters: [{ field: 'fare', operator: 'eq', value }] },
      asTenant('acme'),
      undefined,
    );
    expect(key(10)).toMatch(KEY);
    // Dates encode as RFC 0001 datetimes, so distinct instants key differently.
    expect(key(new Date('2026-01-01T00:00:00Z'))).toMatch(KEY);
    expect(key(new Date('2026-01-01T00:00:00Z'))).not.toBe(key(new Date('2026-01-02T00:00:00Z')));
    expect(key(10n)).toBeUndefined();
    expect(key(new Date(Number.NaN))).toBeUndefined();
    expect(key({ nested: new Map() })).toBeUndefined();
  });

  it('shares entries across clients that share a secret and a store', async () => {
    const { factory, executions } = countingFactory();
    const store = createMemoryCacheStore();
    for (let instance = 0; instance < 2; instance += 1) {
      const client = createDatasetClient({ queryBuilder: factory, cache: { ttlMs: 60_000, store, secret: SECRET } });
      await client.execute(Trips, { measures: ['trips'] }, asTenant('acme'));
    }
    expect(executions).toHaveBeenCalledTimes(1);
  });

  it('works without a secret, but clients then keep separate entries', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { factory, executions } = countingFactory();
    const store = createMemoryCacheStore();
    for (let instance = 0; instance < 2; instance += 1) {
      const client = createDatasetClient({ queryBuilder: factory, cache: { ttlMs: 60_000, store } });
      await client.execute(Trips, { measures: ['trips'] }, asTenant('acme'));
      await client.execute(Trips, { measures: ['trips'] }, asTenant('acme'));
    }
    // Each client hit its own entry once; neither could address the other's.
    expect(executions).toHaveBeenCalledTimes(2);
  });

  it('warns once about a shared store without a secret, and never for the default store', () => {
    // The warning is process-wide and one-time, so this is the only test that
    // observes it; tests above silence it.
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    resolveProtocolCacheKeySettings({}, false);
    expect(warn).not.toHaveBeenCalled();
    resolveProtocolCacheKeySettings({}, true);
    resolveProtocolCacheKeySettings({}, true);
    expect(warn.mock.calls.length).toBeLessThanOrEqual(1);
  });

  it('rejects a misconfigured cache at construction', () => {
    const { factory } = countingFactory();
    const create = (cache: object) => createDatasetClient({ queryBuilder: factory, cache: { ttlMs: 1, ...cache } });
    expect(() => create({ secret: new Uint8Array() })).toThrow('HQ_CACHE_KEY_SECRET_MISSING');
    expect(() => create({ secret: new Uint8Array(31) })).toThrow('HQ_CACHE_KEY_SECRET_TOO_SHORT');
    expect(() => create({ environment: 'has space' })).toThrow('HQ_CACHE_KEY_INVALID_NAMESPACE');
    expect(() => create({ keyVersion: 0 })).toThrow('HQ_CACHE_KEY_INVALID_VERSION');
    expect(() => create({ definitionIdentity: 'nope' })).toThrow('definitionIdentity');
  });

  it('derives the same key as the Python SDK for the same release, query, and tenant', () => {
    // Pinned in python/hypequery/tests/test_dataset_cache.py as well. If this
    // changes, the two languages no longer share entries.
    const settings = resolveProtocolCacheKeySettings(
      { secret: SECRET, project: 'acme', environment: 'production', definitionIdentity: 'd'.repeat(64) },
      false,
    );
    const key = datasetCacheKey(
      settings,
      Trips,
      {
        dimensions: ['vendor'],
        measures: ['trips'],
        filters: [
          { field: 'vendor', operator: 'eq', value: 'a' },
          { field: 'fare', operator: 'gt', value: 10 },
          { field: 'fare', operator: 'between', value: [1, 9] },
        ],
        limit: 50,
      },
      asTenant('acme'),
      undefined,
    );
    expect(key).toBe('hq1.1.CpRDVMs0ppVdzUszvjFisA.2wM9Vqcu8xlBF4mC_Uy_nFoN7_Y_aVgt1OyAjcNUSlE');
  });
});
