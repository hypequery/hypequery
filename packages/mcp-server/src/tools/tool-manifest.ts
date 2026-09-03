import type { CanonicalSemanticQuerySchemas } from '@hypequery/datasets';
import type { ListToolsResult, Tool } from '@modelcontextprotocol/sdk/types.js';

type ObjectSchema = Tool['outputSchema'] & Record<string, unknown>;

const errorEnvelopeSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    error: {
      type: 'object',
      additionalProperties: false,
      properties: {
        code: {
          type: 'string',
          enum: [
            'MCP_INVALID_ARGUMENTS',
            'MCP_NOT_FOUND',
            'MCP_UNKNOWN_TOOL',
            'MCP_UNAUTHORIZED',
            'MCP_STALE_CONTRACT',
            'MCP_REQUEST_CANCELLED',
            'MCP_QUERY_TIMEOUT',
            'MCP_RESULT_TOO_LARGE',
            'MCP_EXECUTION_FAILED',
          ],
        },
        message: { type: 'string' },
        category: {
          type: 'string',
          enum: [
            'correctable_input',
            'unauthorized',
            'stale_contract',
            'budget',
            'internal',
          ],
        },
        retryable: { type: 'boolean' },
        correctable: { type: 'boolean' },
      },
      required: ['code', 'category', 'message', 'retryable', 'correctable'],
    },
  },
  required: ['error'],
};

function resultSchema(successSchema: Record<string, unknown>): ObjectSchema {
  return {
    type: 'object',
    oneOf: [successSchema, errorEnvelopeSchema],
  } as ObjectSchema;
}

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
  },
  required: ['datasets', 'total'],
});

export const DATASET_SCHEMA_OUTPUT_SCHEMA = resultSchema({
  type: 'object',
  additionalProperties: false,
  properties: {
    name: { type: 'string' },
    description: { type: 'string' },
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

export function buildMCPToolManifest(
  querySchemas: CanonicalSemanticQuerySchemas,
): ListToolsResult {
  return {
    tools: [
      {
        name: 'list_datasets',
        title: 'List datasets',
        description: 'List all available datasets in the semantic layer',
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
    ],
  };
}
