import type { ClientContractQuerySchemas } from '@hypequery/datasets';
import type { ListToolsResult } from '@modelcontextprotocol/sdk/types.js';
import { buildMCPToolManifest } from '../../tools/tool-manifest.js';
import { resultSchema } from '../../tools/utils/result-schema.js';

const profileOutput = resultSchema({
  type: 'object', additionalProperties: false, required: ['name', 'queryable', 'endpoints'],
  properties: { name: { type: 'string' }, label: { type: 'string' }, description: { type: 'string' }, queryable: { type: 'boolean' }, endpoints: { type: 'array', items: { type: 'object' } } },
});
const listOutput = resultSchema({
  type: 'object', additionalProperties: false, required: ['datasets', 'total'],
  properties: {
    datasets: { type: 'array', items: { type: 'object', additionalProperties: false,
      required: ['name', 'description', 'queryable', 'dimensionCount', 'measureCount', 'metricCount'],
      properties: { name: { type: 'string' }, label: { type: 'string' }, description: { type: 'string' }, queryable: { type: 'boolean' },
        dimensionCount: { type: 'integer', minimum: 0 }, measureCount: { type: 'integer', minimum: 0 }, metricCount: { type: 'integer', minimum: 0 } },
    } }, total: { type: 'integer', minimum: 0 },
  },
});
const queryOutput = resultSchema({
  type: 'object', additionalProperties: false, required: ['data'],
  properties: {
    data: { type: 'array', maxItems: 1000, items: { type: 'object', additionalProperties: { type: ['string', 'number', 'boolean', 'null'] } } },
    meta: { type: ['object', 'null'], additionalProperties: false,
      required: ['requestId', 'timingMs', 'rowCount', 'pagination'],
      properties: {
        requestId: { type: 'string' }, timingMs: { type: 'number', minimum: 0 }, rowCount: { type: 'integer', minimum: 0 },
        pagination: { type: 'object', additionalProperties: false, required: ['limit', 'offset', 'hasMore'],
          properties: { limit: { type: 'integer', minimum: 1 }, offset: { type: 'integer', minimum: 0 }, hasMore: { type: 'boolean' } } },
        cache: { type: 'object', additionalProperties: false, required: ['hit'], properties: { hit: { type: 'boolean' } } },
      },
    },
  },
});

/** Fixed tool names, canonical client input schemas, and the actual public HTTP result envelope. */
export function clientHttpManifest(schemas: ClientContractQuerySchemas, authorizedHash: string): ListToolsResult {
  const manifest = buildMCPToolManifest(schemas);
  for (const tool of manifest.tools) {
    if (tool.name === 'get_dataset_schema') {
      tool.description = 'Inspect authorized endpoint profiles for a dataset group. Each endpoint retains its own permissions and defaults; annotations carry backend-authored field labels and descriptions.';
      tool.inputSchema = { type: 'object', additionalProperties: false, properties: { dataset: { type: 'string' } }, required: ['dataset'] };
      tool.outputSchema = profileOutput;
    } else if (tool.name === 'list_datasets') {
      tool.description = 'List authorized dataset groups with their descriptions, including metric-only groups whose queryable flag is false.';
      tool.inputSchema = { type: 'object', additionalProperties: false, properties: {} };
      tool.outputSchema = listOutput;
    } else tool.outputSchema = queryOutput;
  }
  return { ...manifest, _meta: {
    'com.hypequery/clientContractHash': authorizedHash,
    'com.hypequery/manifestHash': schemas.manifestHash,
  } };
}
