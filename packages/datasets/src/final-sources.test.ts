import { describe, expect, it, vi } from 'vitest';
import { createQueryBuilder } from '../../clickhouse/src/index.js';
import {
  belongsTo,
  buildProtocolDatasetContract,
  checkRelationships,
  createDatasetClient,
  dataset,
  dimension,
  divide,
  measure,
  nullIfZero,
} from './index.js';
import { createInMemoryBackend } from './in-memory-backend.js';
import { buildProtocolDeploymentContract } from './protocol-deployment-adapter.js';
import { rehydrateProtocolDatasets } from './protocol-rehydrate.js';
import { buildDatasetQuerySignature } from './cache/query-signature.js';
import { datasetCacheKey, metricCacheKey, resolveProtocolCacheKeySettings } from './cache/protocol-cache-keys.js';
import type { QueryBuilderFactoryLike, QueryBuilderLike } from './query-builder-protocol.js';

// A ReplacingMergeTree dimension table: one row per tenant version.
const Tenants = dataset('tenants', {
  source: 'hq_saas.tenants',
  final: true,
  dimensions: {
    id: dimension.string({ column: 'tenant_id' }),
    plan: dimension.string(),
  },
  measures: {
    tenantCount: measure.count('tenant_id'),
  },
});

// A ReplacingMergeTree fact table: one row per subscription status change.
const Subscriptions = dataset('subscriptions', {
  source: 'hq_saas.subscriptions',
  final: true,
  timeKey: 'started_at',
  dimensions: {
    status: dimension.string(),
    startedAt: dimension.timestamp({ column: 'started_at' }),
  },
  measures: {
    mrr: measure.sum('mrr'),
    subscriptionCount: measure.count('subscription_id'),
    trailingMrr: measure.trailing('mrr', { amount: 7, unit: 'day' }),
  },
  relationships: {
    tenant: belongsTo(() => Tenants, { from: 'tenant_id', to: 'tenant_id' }),
  },
});

// The same table without row resolution, as a baseline.
const RawSubscriptions = dataset('raw_subscriptions', {
  source: 'hq_saas.subscriptions',
  dimensions: { status: dimension.string() },
  measures: { mrr: measure.sum('mrr') },
});

const client = createDatasetClient({ queryBuilder: createQueryBuilder({ host: 'http://localhost:8123' }) });

describe('final: true datasets', () => {
  it('reads the source with FINAL in dataset queries', () => {
    const sql = client.toSQL(Subscriptions, { dimensions: ['status'], measures: ['mrr'] });
    expect(sql).toContain('FROM hq_saas.subscriptions FINAL');
  });

  it('leaves datasets without final unchanged', () => {
    const sql = client.toSQL(RawSubscriptions, { dimensions: ['status'], measures: ['mrr'] });
    expect(sql).toContain('FROM hq_saas.subscriptions');
    expect(sql).not.toContain('FINAL');
  });

  it('reads the source with FINAL in metric queries', () => {
    const mrr = Subscriptions.metric('mrr', { measure: 'mrr' });
    const sql = client.toSQL(mrr, { dimensions: ['status'] });
    expect(sql).toContain('FROM hq_saas.subscriptions FINAL');
  });

  it('reads the source with FINAL inside derived metric CTEs', () => {
    const mrr = Subscriptions.metric('mrr', { measure: 'mrr' });
    const count = Subscriptions.metric('subscriptionCount', { measure: 'subscriptionCount' });
    const arpa = Subscriptions.metric('arpa', {
      uses: { mrr, count },
      formula: ({ mrr: m, count: c }) => divide(m, nullIfZero(c)),
    });
    const sql = client.toSQL(arpa, { dimensions: ['status'] });
    expect(sql.match(/FROM hq_saas\.subscriptions FINAL/g)?.length).toBeGreaterThanOrEqual(1);
    expect(sql).not.toMatch(/FROM hq_saas\.subscriptions(?! FINAL)/);
  });

  it('reads the source with FINAL in time-window measures', () => {
    const sql = client.toSQL(Subscriptions, {
      measures: ['trailingMrr'],
      by: 'day',
      filters: [{ field: 'startedAt', operator: 'between', value: ['2026-01-01T00:00:00Z', '2026-02-01T00:00:00Z'] }],
    });
    expect(sql).toContain('hq_saas.subscriptions FINAL');
    expect(sql).not.toMatch(/FROM hq_saas\.subscriptions(?! FINAL)/);
  });

  it('reads a final relationship target with FINAL inside the join projection', () => {
    const sql = client.toSQL(Subscriptions, { dimensions: ['tenant.plan'], measures: ['mrr'] });
    expect(sql).toContain('FROM hq_saas.subscriptions FINAL');
    expect(sql).toContain('FROM `hq_saas`.`tenants` FINAL)');
  });

  it('refuses a builder that cannot apply FINAL', () => {
    const real = createQueryBuilder({ host: 'http://localhost:8123' });
    const withoutFinal: QueryBuilderFactoryLike = {
      table: (name: string) => {
        const qb = real.table(name as never) as unknown as QueryBuilderLike;
        return new Proxy(qb, {
          get: (target, prop, receiver) => (prop === 'final' ? undefined : Reflect.get(target, prop, receiver)),
        });
      },
      rawQuery: real.rawQuery.bind(real) as QueryBuilderFactoryLike['rawQuery'],
    };
    const limited = createDatasetClient({ queryBuilder: withoutFinal });
    expect(() => limited.toSQL(Subscriptions, { measures: ['mrr'] })).toThrow(
      'Dataset "subscriptions" reads its source with FINAL, but the query builder does not implement final()',
    );
    expect(limited.toSQL(RawSubscriptions, { measures: ['mrr'] })).not.toContain('FINAL');
  });

  it('refuses semantic backends, which cannot apply FINAL', async () => {
    const backend = createDatasetClient({ backend: createInMemoryBackend({ 'hq_saas.subscriptions': [] }) });
    await expect(async () => backend.execute(Subscriptions, { measures: ['mrr'] })).rejects.toThrow(
      'Dataset "subscriptions" reads its source with FINAL, which requires the queryBuilder execution path.',
    );
  });

  it('refuses joins to a final target on semantic backends', async () => {
    const PlainSubscriptions = dataset('plain_subscriptions', {
      source: 'hq_saas.subscriptions',
      dimensions: { status: dimension.string() },
      measures: { mrr: measure.sum('mrr') },
      relationships: { tenant: belongsTo(() => Tenants, { from: 'tenant_id', to: 'tenant_id' }) },
    });
    const backend = createDatasetClient({ backend: createInMemoryBackend({ 'hq_saas.subscriptions': [], 'hq_saas.tenants': [] }) });
    await expect(async () => backend.execute(PlainSubscriptions, { dimensions: ['tenant.plan'], measures: ['mrr'] })).rejects.toThrow(
      'Dataset "tenants" reads its source with FINAL',
    );
  });

  it('checks relationship keys on the resolved target rows', async () => {
    const tables: string[] = [];
    let finalApplied = false;
    const recordingFactory: QueryBuilderFactoryLike = {
      table: (name: string) => {
        tables.push(name);
        const qb: QueryBuilderLike = new Proxy({} as QueryBuilderLike, {
          get: (_target, prop) => {
            if (prop === 'final') return () => { finalApplied = true; return qb; };
            if (prop === 'execute') return async () => [{ _hq_rows: 3, _hq_keys: 3 }];
            return () => qb;
          },
        });
        return qb;
      },
      rawQuery: async () => [],
    };
    await checkRelationships(Subscriptions, { queryBuilder: recordingFactory });
    expect(tables).toEqual(['hq_saas.tenants']);
    expect(finalApplied).toBe(true);
  });

  it('rejects a non-boolean final at definition time', () => {
    expect(() => dataset('bad', {
      source: 'events',
      final: 'yes' as never,
      dimensions: { id: dimension.string() },
    })).toThrow('final must be true or false.');
  });

  it('is the deprecated spelling of rowResolution { kind: final }, and survives publishing', () => {
    // One representation: final: true is read as rowResolution { kind: 'final' }.
    expect(Tenants.rowResolution).toEqual({ kind: 'final' });
    expect(Tenants.final).toBe(true);
    expect(buildProtocolDatasetContract(Tenants).rowResolution).toEqual({ kind: 'final' });
    const hydrated = rehydrateProtocolDatasets(buildProtocolDeploymentContract([Tenants]).datasets).tenants;
    expect(hydrated.rowResolution).toEqual({ kind: 'final' });
    expect(hydrated.final).toBe(true);
    const client = createDatasetClient({ queryBuilder: createQueryBuilder({ host: 'http://127.0.0.1:8123' }) });
    const query = { dimensions: ['plan'], measures: ['tenantCount'] };
    expect(client.toSQL(hydrated, query)).toBe(client.toSQL(Tenants, query));
    expect(client.toSQL(hydrated, query)).toContain('FROM hq_saas.tenants FINAL');
    expect(buildDatasetQuerySignature(hydrated, query)).toBe(buildDatasetQuerySignature(Tenants, query));
  });

  it('matches rowResolution { kind: final } exactly: same SQL and cache key', () => {
    const Explicit = dataset('tenants', { ...Tenants, final: undefined, rowResolution: { kind: 'final' } } as never);
    const client = createDatasetClient({ queryBuilder: createQueryBuilder({ host: 'http://127.0.0.1:8123' }) });
    const query = { dimensions: ['plan'], measures: ['tenantCount'] };
    expect(client.toSQL(Explicit, query)).toBe(client.toSQL(Tenants, query));
    expect(buildDatasetQuerySignature(Explicit, query)).toBe(buildDatasetQuerySignature(Tenants, query));
  });

  it('warns once that final: true is deprecated, and never for rowResolution', async () => {
    vi.resetModules();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const fresh = await import('./index.js');
      const define = (name: string, config: object) =>
        fresh.dataset(name, { source: name, dimensions: { id: fresh.dimension.string() }, ...config } as never);
      define('modern', { rowResolution: { kind: 'final' } });
      expect(warn).not.toHaveBeenCalled();
      define('legacy_a', { final: true });
      define('legacy_b', { final: true });
      expect(warn).toHaveBeenCalledTimes(1);
      expect(String(warn.mock.calls[0]![0])).toContain("`final: true` is deprecated. Use `rowResolution: { kind: 'final' }`");
    } finally {
      warn.mockRestore();
    }
  });

  it('separates result-cache keys by final, on the dataset and on a joined target', () => {
    const settings = resolveProtocolCacheKeySettings({ secret: new Uint8Array(32).fill(7) }, false);
    const tenants = (final: boolean) => dataset('cache_tenants', {
      source: 'hq_saas.tenants',
      final,
      dimensions: { id: dimension.string({ column: 'tenant_id' }), plan: dimension.string() },
    });
    // Identical definitions except for the `final` flag on the base or the target.
    const subscriptions = (final: boolean, targetFinal: boolean) => {
      const target = tenants(targetFinal);
      return dataset('cache_subscriptions', {
        source: 'hq_saas.subscriptions',
        final,
        dimensions: { status: dimension.string() },
        measures: { mrr: measure.sum('mrr') },
        relationships: { tenant: belongsTo(() => target, { from: 'tenant_id', to: 'tenant_id' }) },
      });
    };
    const query = { dimensions: ['tenant.plan'], measures: ['mrr'], limit: 100 };
    const datasetKey = (final: boolean, targetFinal: boolean) =>
      datasetCacheKey(settings, subscriptions(final, targetFinal), query, undefined, undefined);
    const metricKey = (final: boolean, targetFinal: boolean) =>
      metricCacheKey(settings, subscriptions(final, targetFinal).metric('mrr', { measure: 'mrr' }), query, undefined, undefined);

    for (const key of [datasetKey, metricKey]) {
      const raw = key(false, false);
      expect(raw).toBeDefined();
      expect(key(false, false)).toBe(raw);
      expect(key(true, false)).not.toBe(raw);
      expect(key(false, true)).not.toBe(raw);
      expect(key(true, true)).not.toBe(key(true, false));
    }
  });

  it('separates the exported query signature by final and keeps existing signatures unchanged', () => {
    const query = { dimensions: ['status'], measures: ['mrr'] };
    const finalKey = buildDatasetQuerySignature(Subscriptions, query);
    const rawKey = buildDatasetQuerySignature(RawSubscriptions, query);
    expect(finalKey).toContain('"rowResolution":{"kind":"final"}');
    expect(rawKey).not.toContain('final');
  });
});
