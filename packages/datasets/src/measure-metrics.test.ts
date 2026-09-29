import { metricCacheKey, resolveProtocolCacheKeySettings } from './cache/protocol-cache-keys.js';
import { describe, expect, it, vi } from 'vitest';
import { createQueryBuilder } from '../../clickhouse/src/index.js';
import { createDatasetClient, dataset, dimension, measure, multiply, generateDatasetTools, buildProtocolDatasetContract, serializeSemanticContract } from './index.js';
import { createInMemoryBackend } from './in-memory-backend.js';
import { getDatasetCatalog } from './catalog.js';
import { projectAgentSafeCatalog } from './agent-catalog.js';
import { buildMetricQuerySignature } from './cache/query-signature.js';

const client = createDatasetClient({ queryBuilder: createQueryBuilder({ host: 'http://localhost:8123' }) });
function model(coefficient = 2) {
  return dataset('events', { source: 'events', timeKey: 'time', dimensions: { time: dimension.timestamp(), value: dimension.number() }, measures: {
    revenue: measure.sum('value'), ytd: measure.toDate('revenue', 'year'), priorYtd: measure.shift('ytd', { amount: 1, unit: 'year' }),
    doubled: measure.derived({ uses: { value: 'revenue' }, formula: ({ value }) => multiply(value, coefficient) }),
  } });
}
const Events = model();
const PriorYtd = Events.metric('previousYtd', { measure: 'priorYtd' });
const filters = [{ field: 'time', operator: 'between' as const, value: ['2024-02-01', '2024-02-15'] }];

describe('dataset measure metric contracts', () => {
  it('advertises inherited grains and time range requirements in every local catalog', () => {
    const source = { ...Events, metrics: { previousYtd: PriorYtd } };
    expect(PriorYtd.contract().grains).toEqual(['day', 'month', 'quarter']);
    expect(PriorYtd.contract().requiresTimeRange).toBe(true);
    expect(getDatasetCatalog(source).metrics.previousYtd.requiresTimeRange).toBe(true);
    expect(projectAgentSafeCatalog({ events: source }).datasets[0].metrics[0].requiresTimeRange).toBe(true);
    expect(serializeSemanticContract({ events: source }).datasets.events.metrics.previousYtd.requiresTimeRange).toBe(true);
    expect(() => PriorYtd.by('year')).toThrow(/does not support grain/);
  });
  it('validates transitive time requirements and renders the metric alias', () => {
    expect(client.validate(PriorYtd, {}).valid).toBe(false);
    expect(client.validate(PriorYtd, { by: 'month', filters }).valid).toBe(true);
    expect(client.toSQL(PriorYtd, { by: 'month', filters })).toContain('`priorYtd` AS `previousYtd`');
  });
  it('includes ordinary formula ASTs in metric cache keys', () => {
    const first = model(2).metric('value', { measure: 'doubled' });
    const second = model(3).metric('value', { measure: 'doubled' });
    const settings = resolveProtocolCacheKeySettings({ secret: new Uint8Array(32).fill(7) }, false);
    const firstKey = metricCacheKey(settings, first, {}, undefined, undefined);
    expect(firstKey).toBeDefined();
    expect(firstKey).not.toBe(metricCacheKey(settings, second, {}, undefined, undefined));
    expect(buildMetricQuerySignature(first, {})).not.toBe(buildMetricQuerySignature(second, {}));
    expect(buildMetricQuerySignature(PriorYtd, { by: 'month', filters })).not.toBe(buildMetricQuerySignature(PriorYtd, { by: 'month', filters, timezone: 'Europe/Madrid' }));
  });
  it('caches named formula results and rejects invalid time queries before lookup', async () => {
    const builder = createQueryBuilder({ host: 'http://localhost:8123' });
    const calls = vi.fn();
    const cached = createDatasetClient({ queryBuilder: { table: (name: string) => builder.table(name),
      rawQuery: async <T,>() => { calls(); return [{ namedValue: 12 }] as T[]; },
    }, cache: { ttlMs: 60_000 } });
    const metric = Events.metric('namedValue', { measure: 'doubled' });
    expect((await cached.execute(metric)).data).toEqual([{ namedValue: '12' }]);
    expect((await cached.execute(metric)).meta?.cache?.hit).toBe(true);
    expect(calls).toHaveBeenCalledOnce();
    const changed = model(3).metric('namedValue', { measure: 'doubled' });
    expect((await cached.execute(changed)).meta?.cache?.hit).toBe(false);
    expect(calls).toHaveBeenCalledTimes(2);
    await expect(async () => cached.execute(PriorYtd, { by: 'month' })).rejects.toThrow(/bounded time range/);
    expect(calls).toHaveBeenCalledTimes(2);
  });
  it('generates agent metric tools with inherited query grain restrictions', () => {
    const tools = generateDatasetTools({ datasets: { events: { ...Events, metrics: { previousYtd: PriorYtd } } }, analytics: client, mode: 'per-metric' });
    expect(tools[0].parameters.properties?.by.enum).toEqual(['day', 'month', 'quarter']);
  });
  it('rejects execution and SQL generation on the frozen backend', async () => {
    const backend = createDatasetClient({ backend: createInMemoryBackend({ events: [] }) });
    expect(backend.validate(PriorYtd, { by: 'month', filters }).valid).toBe(false);
    expect(() => backend.toSQL(PriorYtd, { by: 'month', filters })).toThrow(/queryBuilder/);
    expect(() => backend.execute(PriorYtd, { by: 'month', filters })).toThrow(/queryBuilder/);
  });
  it('rejects measure metric definitions in unsupported deployment contracts', () => {
    const ds = dataset('ordinary', { source: 'events', dimensions: { value: dimension.number() }, measures: {
      revenue: measure.sum('value'), doubled: Events.measures.doubled,
    } });
    const metric = ds.metric('doubled', { measure: 'doubled' });
    expect(() => buildProtocolDatasetContract(ds, { metrics: { doubled: metric }, metricEndpoints: { doubled: { access: { kind: 'public' }, tenant: { kind: 'none' }, maxLimit: 100, path: '/metrics/doubled' } } })).toThrow(/Dataset measure metrics.*deployment contract/);
  });
});
