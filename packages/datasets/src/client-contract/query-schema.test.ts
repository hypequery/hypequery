import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { buildClientContractQuerySchemas } from './query-schema.js';
const directory = new URL('../../../../specs/security-protocol/fixtures/client-contract-v1/', import.meta.url);
const success = JSON.parse(readFileSync(new URL('success.json', directory), 'utf8')) as {id: string; value: unknown}[];
const queries = [...JSON.parse(readFileSync(new URL('queries.json', directory), 'utf8')), ...JSON.parse(readFileSync(new URL('query-rejections.json', directory), 'utf8'))] as {
  id: string; contract: string; endpoint: string; input: Record<string, unknown>; error?: string; transport?: string;
}[];
const compiled = Object.fromEntries(success.map(item => [item.id, buildClientContractQuerySchemas(item.value)]));
describe('client descriptor query compiler', () => {
  it.each(queries)('agrees with the strict shared query profile: $id', test => {
    const schemas = compiled[test.contract];
    const schema = test.transport === 'mcp' ? schemas.queryDataset : schemas.endpoints.get(test.endpoint)?.http;
    expect(schema?.safeParse(test.input).success ?? false).toBe(!test.error);
  });
  it('keeps metric-only groups uncallable as datasets', () => {
    const schemas = compiled['metric-only'];
    expect(schemas.queryDataset.safeParse({ dataset: 'orders' }).success).toBe(false);
    expect(schemas.queryMetric.safeParse({ dataset: 'orders', metric: 'ordersRevenue' }).success).toBe(true);
    expect(schemas.queryMetric.safeParse({ dataset: 'orders', metric: 'revenue' }).success).toBe(false);
  });
  it('keeps fixed empty tool schemas uncallable', () => {
    const schemas = compiled.empty;
    for (const value of [{}, { dataset: 'orders' }, { dataset: 'orders', metric: 'ordersRevenue' }]) {
      expect(schemas.queryDataset.safeParse(value).success).toBe(false);
      expect(schemas.queryMetric.safeParse(value).success).toBe(false);
    }
    expect(schemas.queryDatasetJsonSchema).toMatchObject({ type: 'object', required: ['dataset'], properties: { dataset: { not: {} } } });
  });
  it('emits typed JSON filter values rather than unknown values', () => {
    const schema = compiled.build.endpoints.get('orders')!.httpJsonSchema;
    const filters = schema.properties!.filters.items!;
    const clauses = filters.anyOf!;
    const numeric = clauses.find(item => item.properties?.field?.const === 'amount' && item.properties?.operator?.const === 'eq');
    expect(numeric?.properties?.value).toMatchObject({ type: 'number' });
    expect(schema).toMatchObject({ additionalProperties: false });
    expect(compiled.build.manifestHash).toBe(compiled.build.contract.contentHash);
  });
  it('runs dependent checks beyond the exported structural JSON schema', () => {
    const schema = compiled.build.endpoints.get('orders')!.http;
    for (const input of [{ dimensions: ['country', 'country'] }, { measures: ['orderCount'], having: [{ measure: 'revenue', operator: 'gt', value: 1 }] },
      { orderBy: [{ field: 'country', direction: 'asc' }] }, { timezone: 'Invalid/Timezone' }]) {
      expect(schema.safeParse(input).success).toBe(false);
    }
  });
});
