import { ListToolsResultSchema } from '@modelcontextprotocol/sdk/types.js';
import { AjvJsonSchemaValidator } from '@modelcontextprotocol/sdk/validation/ajv';
import { describe, expect, it } from 'vitest';
import { buildMCPQuerySchemas } from './utils/canonical-query-schemas.js';
import { buildMCPToolManifest, DATASET_SCHEMA_OUTPUT_SCHEMA } from './tool-manifest.js';
import { getDatasetSchemaTool } from './introspect.js';
import { dataset, dimension, measure, projectAgentSafeCatalog } from '@hypequery/datasets';

describe('MCP tool manifest', () => {
  it('advertises every field get_dataset_schema emits for a fully annotated dataset', async () => {
    const orders = dataset('orders', {
      source: 'orders',
      timeKey: 'time',
      description: 'Orders',
      synonyms: ['sales'],
      sensitivity: 'internal',
      freshness: { maxAgeSeconds: 3600 },
      owner: 'analytics',
      defaults: { dimensions: ['status'], timeGrain: 'day' },
      dimensions: {
        time: dimension.timestamp(),
        status: dimension.string({ label: 'Status', examples: ['paid'] }),
      },
      measures: {
        revenue: measure.sum('amount', { currency: 'USD', format: 'currency' }),
        users: measure.approxCountDistinct('user'),
        runningRevenue: measure.cumulative('revenue'),
        weeklyRevenue: measure.trailing('revenue', { amount: 7, unit: 'day' }),
        monthToDate: measure.toDate('revenue', 'month'),
        prior: measure.shift('users', { amount: 1, unit: 'year' }),
      },
      segments: {
        paid: { filters: [{ field: 'status', operator: 'eq', value: 'paid' }], label: 'Paid', description: 'Paid orders' },
        open: { filters: [{ field: 'status', operator: 'eq', value: 'open' }] },
      },
      limits: { maxDimensions: 5, maxResultSize: 1000 },
    });
    const response = await getDatasetSchemaTool({ orders }, { dataset: 'orders' });
    const validate = new AjvJsonSchemaValidator().getValidator(DATASET_SCHEMA_OUTPUT_SCHEMA as any);

    expect(response.structuredContent).toMatchObject({
      segments: [{ name: 'open' }, { name: 'paid', label: 'Paid', description: 'Paid orders' }],
      freshness: { maxAgeSeconds: 3600 },
      owner: 'analytics',
    });
    expect(validate(response.structuredContent)).toMatchObject({ valid: true });
  });
  it('allows every error code in the error envelope', () => {
    const validate = new AjvJsonSchemaValidator().getValidator(DATASET_SCHEMA_OUTPUT_SCHEMA as any);
    expect(validate({ error: {
      code: 'MCP_CATALOG_TOO_LARGE', category: 'budget', message: 'too large', retryable: false, correctable: false,
    } })).toMatchObject({ valid: true });
  });
  it('advertises every field in shifted measure metadata', () => {
    const orders = dataset('orders', { source: 'orders', timeKey: 'time', dimensions: { time: dimension.timestamp() },
      measures: { users: measure.approxCountDistinct('user'), prior: measure.shift('users', { amount: 1, unit: 'year' }) },
    });
    const metadata = projectAgentSafeCatalog({ orders }).datasets[0].measures.find(item => item.name === 'prior')!;
    const manifest = buildMCPToolManifest(buildMCPQuerySchemas({ orders }));
    const schema = manifest.tools.find(tool => tool.name === 'get_dataset_schema')!.outputSchema as any;
    const properties = schema.oneOf[0].properties.measures.items.properties;
    for (const key of Object.keys(metadata)) expect(properties).toHaveProperty(key);
  });
  it('declares valid output schemas, titles, and read-only annotations', () => {
    const manifest = buildMCPToolManifest(buildMCPQuerySchemas({}));

    expect(() => ListToolsResultSchema.parse(manifest)).not.toThrow();
    expect(manifest.tools).toHaveLength(4);
    for (const tool of manifest.tools) {
      expect(tool.title).toEqual(expect.any(String));
      expect(tool.outputSchema).toMatchObject({ type: 'object' });
      expect(tool.annotations).toMatchObject({
        title: tool.title,
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      });
    }
  });
});
