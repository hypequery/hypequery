import { ListToolsResultSchema } from '@modelcontextprotocol/sdk/types.js';
import { describe, expect, it } from 'vitest';
import { buildMCPQuerySchemas } from './utils/canonical-query-schemas.js';
import { buildMCPToolManifest } from './tool-manifest.js';
import { dataset, dimension, measure, projectAgentSafeCatalog } from '@hypequery/datasets';

describe('MCP tool manifest', () => {
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
  it('advertises every field in comparison metric metadata', () => {
    const ds = dataset('orders', { source: 'orders', timeKey: 'time', dimensions: { time: dimension.timestamp() }, measures: {
      users: measure.count('user'), prior: measure.shift('users', { amount: 1, unit: 'year' }),
    } });
    const orders = { ...ds, metrics: { previous: ds.metric('previous', { measure: 'prior' }) } };
    const metadata = projectAgentSafeCatalog({ orders }).datasets[0].metrics[0];
    const manifest = buildMCPToolManifest(buildMCPQuerySchemas({ orders }));
    const schema = manifest.tools.find(tool => tool.name === 'get_dataset_schema')!.outputSchema as any;
    for (const key of Object.keys(metadata)) expect(schema.oneOf[0].properties.metrics.items.properties).toHaveProperty(key);
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
