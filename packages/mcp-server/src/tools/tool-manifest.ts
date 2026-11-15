import { SUPPORTED_TIME_GRAINS } from '@hypequery/datasets';
import type { CanonicalSemanticQuerySchemas } from '@hypequery/datasets/schemas';
import type { ListToolsResult, Tool } from '@modelcontextprotocol/sdk/types.js';
import { resultSchema } from './utils/result-schema.js';

const semanticMetadataProperties = {
  examples: { type: 'array', items: { type: 'string' } },
  synonyms: { type: 'array', items: { type: 'string' } },
  format: { type: 'string' },
  unit: { type: 'string' },
  currency: { type: 'string' },
  sensitivity: {
    type: 'string',
    enum: ['public', 'internal', 'confidential', 'restricted'],
  },
};

const businessContextProperties = {
  summary: { type: 'string' },
  industry: { type: 'string' },
  businessModel: { type: 'string' },
  customers: { type: 'string' },
  audience: { type: 'string' },
  goals: { type: 'array', items: { type: 'string' } },
  kpis: {
    type: 'array',
    items: {
      type: 'object',
      additionalProperties: false,
      properties: { name: { type: 'string' }, definition: { type: 'string' } },
      required: ['name', 'definition'],
    },
  },
  glossary: {
    type: 'array',
    items: {
      type: 'object',
      additionalProperties: false,
      properties: { term: { type: 'string' }, meaning: { type: 'string' } },
      required: ['term', 'meaning'],
    },
  },
  conventions: { type: 'string' },
  caveats: { type: 'array', items: { type: 'string' } },
};

export const BUSINESS_CONTEXT_OUTPUT_SCHEMA = resultSchema({
  type: 'object',
  additionalProperties: false,
  properties: {
    businessContext: {
      type: 'object',
      additionalProperties: false,
      properties: businessContextProperties,
    },
  },
  required: ['businessContext'],
});

export const DATASET_LIST_OUTPUT_SCHEMA = resultSchema({
  type: 'object',
  additionalProperties: false,
  properties: {
    datasets: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          name: { type: 'string' },
          description: { type: 'string' },
          dimensionCount: { type: 'integer', minimum: 0 },
          measureCount: { type: 'integer', minimum: 0 },
          metricCount: { type: 'integer', minimum: 0 },
        },
        required: ['name', 'description', 'dimensionCount', 'metricCount'],
      },
    },
    total: { type: 'integer', minimum: 0 },
    businessContext: {
      type: 'object',
      additionalProperties: false,
      properties: {
        ...businessContextProperties,
        truncated: { type: 'boolean' },
        hint: { type: 'string' },
      },
    },
  },
  required: ['datasets', 'total'],
});

export const DATASET_SCHEMA_OUTPUT_SCHEMA = resultSchema({
  type: 'object',
  additionalProperties: false,
  properties: {
    name: { type: 'string' },
    description: { type: 'string' },
    ...semanticMetadataProperties,
    freshness: {
      type: 'object',
      additionalProperties: false,
      properties: { maxAgeSeconds: { type: 'integer', minimum: 1 } },
      required: ['maxAgeSeconds'],
    },
    owner: { type: 'string' },
    defaults: {
      type: 'object',
      additionalProperties: false,
      properties: {
        dimensions: { type: 'array', items: { type: 'string' } },
        timeGrain: { type: 'string', enum: [...SUPPORTED_TIME_GRAINS] },
      },
    },
    timeDimension: { type: ['string', 'null'] },
    dimensions: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          name: { type: 'string' },
          type: { type: 'string', enum: ['boolean', 'number', 'string', 'timestamp'] },
          label: { type: 'string' },
          description: { type: 'string' },
          ...semanticMetadataProperties,
          filterable: { type: 'boolean' },
          groupable: { type: 'boolean' },
        },
        required: ['name', 'type', 'filterable', 'groupable'],
      },
    },
    measures: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          name: { type: 'string' },
          label: { type: 'string' },
          description: { type: 'string' },
          ...semanticMetadataProperties,
          kind: { type: 'string', enum: ['window', 'shift'] },
          measure: { type: 'string' },
          interval: { type: 'object', properties: { amount: { type: 'integer', minimum: 1 }, unit: { type: 'string', enum: [...SUPPORTED_TIME_GRAINS] } }, required: ['amount', 'unit'], additionalProperties: false },
          trailing: { type: 'object', properties: { amount: { type: 'integer', minimum: 1 }, unit: { type: 'string', enum: [...SUPPORTED_TIME_GRAINS] } }, required: ['amount', 'unit'], additionalProperties: false },
          toDate: { type: 'string', enum: SUPPORTED_TIME_GRAINS.filter(grain => grain !== 'minute') },
          cumulative: { const: true },
          requiresTimeRange: { const: true },
          supportedGrains: { type: 'array', items: { type: 'string', enum: [...SUPPORTED_TIME_GRAINS] } },
          approximate: { const: true },
        },
        required: ['name'],
      },
    },
    metrics: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          name: { type: 'string' },
          label: { type: 'string' },
          description: { type: 'string' },
          ...semanticMetadataProperties,
          dimensions: { type: 'array', items: { type: 'string' } },
          filters: { type: 'array', items: { type: 'string' } },
          grains: { type: 'array', items: { type: 'string' } },
          grain: { type: 'string' },
        },
        required: ['name', 'dimensions', 'filters', 'grains'],
      },
    },
    filters: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          name: { type: 'string' },
          type: { type: 'string', enum: ['boolean', 'number', 'string', 'timestamp'] },
          label: { type: 'string' },
          description: { type: 'string' },
          ...semanticMetadataProperties,
          operators: { type: 'array', items: { type: 'string' } },
        },
        required: ['name', 'type', 'operators'],
      },
    },
    relationships: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          name: { type: 'string' },
          target: { type: 'string' },
          fields: { type: 'array', items: { type: 'string' } },
        },
        required: ['name', 'target', 'fields'],
      },
    },
    segments: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          name: { type: 'string' },
          label: { type: 'string' },
          description: { type: 'string' },
        },
        required: ['name'],
      },
    },
    limits: {
      type: 'object',
      additionalProperties: false,
      properties: {
        maxDimensions: { type: 'integer', minimum: 1 },
        maxMeasures: { type: 'integer', minimum: 1 },
        maxFilters: { type: 'integer', minimum: 1 },
        maxResultSize: { type: 'integer', minimum: 1 },
      },
    },
  },
  required: [
    'name',
    'description',
    'timeDimension',
    'dimensions',
    'measures',
    'metrics',
    'filters',
    'relationships',
  ],
});

export const QUERY_OUTPUT_SCHEMA = resultSchema({
  type: 'object',
  additionalProperties: false,
  properties: {
    data: {
      type: 'array',
      items: { type: 'object', additionalProperties: true },
    },
    meta: {
      type: 'object',
      additionalProperties: false,
      properties: {
        sql: { type: 'string' },
        timingMs: { type: 'number', minimum: 0 },
        rowCount: { type: 'integer', minimum: 0 },
        pagination: {
          type: 'object',
          additionalProperties: false,
          properties: {
            limit: { type: 'integer', minimum: 1 },
            offset: { type: 'integer', minimum: 0 },
            hasMore: { type: 'boolean' },
          },
          required: ['limit', 'offset', 'hasMore'],
        },
        cache: {
          type: 'object',
          additionalProperties: false,
          properties: {
            status: { type: 'string', enum: ['hit', 'miss', 'bypass'] },
            ageMs: { type: 'number', minimum: 0 },
            stale: { type: 'boolean' },
          },
          required: ['status'],
        },
      },
      required: ['rowCount', 'cache'],
    },
  },
  required: ['data', 'meta'],
});

function annotations(title: string): Tool['annotations'] {
  return {
    title,
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: false,
  };
}

export interface MCPToolManifestOptions {
  /** List `get_business_context`, and say in `list_datasets` that it carries the context. */
  businessContext?: boolean;
}

const BUSINESS_CONTEXT_TOOL: Tool = {
  name: 'get_business_context',
  title: 'Get business context',
  description: 'Get the business context for these datasets: what the business does, KPI definitions, the glossary of business terms, reporting conventions (currency, time zone, fiscal year) and known data caveats. Read it before interpreting or presenting numbers.',
  inputSchema: { type: 'object', properties: {} },
  outputSchema: BUSINESS_CONTEXT_OUTPUT_SCHEMA,
  annotations: annotations('Get business context'),
};

export function buildMCPToolManifest(
  querySchemas: CanonicalSemanticQuerySchemas,
  options: MCPToolManifestOptions = {},
): ListToolsResult {
  return {
    tools: [
      {
        name: 'list_datasets',
        title: 'List datasets',
        description: options.businessContext
          ? 'List all available datasets in the semantic layer, with the business context (KPIs, glossary, conventions, caveats) to interpret them'
          : 'List all available datasets in the semantic layer',
        inputSchema: { type: 'object', properties: {} },
        outputSchema: DATASET_LIST_OUTPUT_SCHEMA,
        annotations: annotations('List datasets'),
      },
      {
        name: 'get_dataset_schema',
        title: 'Inspect dataset schema',
        description: 'Get the schema (dimensions, measures, named metrics, filters, relationships) for a specific dataset',
        inputSchema: {
          type: 'object',
          properties: {
            dataset: {
              type: 'string',
              description: 'Name of the dataset to introspect',
            },
          },
          required: ['dataset'],
        },
        outputSchema: DATASET_SCHEMA_OUTPUT_SCHEMA,
        annotations: annotations('Inspect dataset schema'),
      },
      {
        name: 'query_metric',
        title: 'Query named metric',
        description: 'Execute a metric query with optional dimensions, filters, time grain, and sorting',
        inputSchema: querySchemas.queryMetricJsonSchema as Tool['inputSchema'],
        outputSchema: QUERY_OUTPUT_SCHEMA,
        annotations: annotations('Query named metric'),
      },
      {
        name: 'query_dataset',
        title: 'Query dataset',
        description: 'Execute an ad-hoc dataset query with custom dimensions and measures',
        inputSchema: querySchemas.queryDatasetJsonSchema as Tool['inputSchema'],
        outputSchema: QUERY_OUTPUT_SCHEMA,
        annotations: annotations('Query dataset'),
      },
      ...(options.businessContext ? [BUSINESS_CONTEXT_TOOL] : []),
    ],
  };
}
