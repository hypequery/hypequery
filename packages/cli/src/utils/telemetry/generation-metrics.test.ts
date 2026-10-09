import { describe, expect, it } from 'vitest';
import { manifestMetrics, TypeGenerationMetrics, warningBuckets } from './generation-metrics.js';
import { generateTypeDefinitions, type TypeGenerationClickHouseClient } from '../../typegen/generate-types.js';

describe('generation telemetry reduction', () => {
  it('counts actual column mappings once and reduces nested unsupported types to built-in families', async () => {
    const stats = new TypeGenerationMetrics();
    const queries: string[] = [];
    const columns = [
      { name: 'PRIVATE_COLUMN', type: 'Array(Nullable(Variant(String, UInt64)))' },
      { name: 'PRIVATE_AGGREGATE', type: 'AggregateFunction(PRIVATE_FUNCTION, UInt64)' },
      { name: 'PRIVATE_UNKNOWN', type: 'PRIVATE_CUSTOM_TYPE' },
      { name: 'PRIVATE_TIME', type: "DateTime64(3, 'PRIVATE_TIMEZONE')" },
    ];
    const client: TypeGenerationClickHouseClient = { query: async ({ query }) => {
      queries.push(query);
      return { json: async () => query === 'SHOW TABLES' ? [{ name: 'PRIVATE_TABLE' }] : columns };
    } };
    const plain = await generateTypeDefinitions(client, { includeUsageExample: false });
    queries.length = 0;
    const observed = await generateTypeDefinitions(client, { includeUsageExample: false,
      onColumn: () => stats.column(), onUnsupportedType: type => stats.fallback(type) });
    expect(observed).toBe(plain);
    expect(queries).toHaveLength(3);
    expect(stats.snapshot()).toEqual({ column_count_bucket: '2-5', unsupported_type_count_bucket: '2-5', unsupported_type_families: ['AggregateFunction', 'Variant', 'unknown'] });
    expect(JSON.stringify(stats.snapshot())).not.toContain('PRIVATE');
    expect(await generateTypeDefinitions(client, { includeUsageExample: false, onColumn: () => { throw new Error('observer failed'); }, onUnsupportedType: () => { throw new Error('observer failed'); } })).toBe(plain);
  });

  it('buckets warnings by fixed code without their content', () => {
    expect(warningBuckets([
      { kind: 'tenant-key-candidate', table: 'PRIVATE_TABLE', columns: ['PRIVATE_COLUMN'], message: 'PRIVATE_WARNING' },
      { kind: 'tenant-column-missing', table: 'PRIVATE_TABLE', column: 'PRIVATE_TENANT', message: 'PRIVATE_WARNING' },
    ])).toEqual({ 'tenant-key-candidate': '1', 'tenant-column-missing': '1' });
  });

  it('counts manifest and registry entries without calling a user getter', () => {
    const api = { queries: { PRIVATE_QUERY: {}, PRIVATE_OTHER_QUERY: {} } };
    expect(manifestMetrics(api, { PRIVATE_ROUTE: { path: 'PRIVATE_PATH' } })).toEqual({ query_count_bucket: '2-5', endpoint_count_bucket: '1' });
    const hostile = Object.defineProperty({}, 'queries', { get() { throw new Error('PRIVATE_GETTER'); } });
    expect(manifestMetrics(hostile, {})).toEqual({ endpoint_count_bucket: '0' });
  });
});
