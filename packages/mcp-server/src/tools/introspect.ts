/**
 * Get Dataset Schema Tool
 *
 * Returns the complete schema for a dataset including dimensions, metrics,
 * and relationships.
 */

import type { DatasetRegistry, GetDatasetSchemaArgs, MCPToolResponse, DatasetSchema, DimensionSchema, MetricSchema, RelationshipSchema } from '../types.js';

export async function getDatasetSchemaTool(
  datasets: DatasetRegistry,
  args: unknown
): Promise<MCPToolResponse> {
  // Parse and validate args
  const validatedArgs = args as GetDatasetSchemaArgs;
  const datasetName = validatedArgs.dataset;

  if (!datasetName) {
    throw new Error('dataset parameter is required');
  }

  const dataset = datasets[datasetName];

  if (!dataset) {
    throw new Error(`Dataset not found: ${datasetName}`);
  }

  // Build schema response with proper types
  const datasetAny = dataset as any;
  const schema: DatasetSchema = {
    name: datasetName,
    description: datasetAny.description || datasetAny.config?.description || '',
    source: datasetAny.source || datasetAny.config?.source || '',
    timeKey: datasetAny.timeKey || datasetAny.config?.timeKey || null,
    tenantKey: datasetAny.tenantKey || datasetAny.config?.tenantKey || null,
    dimensions: {},
    metrics: {},
    relationships: {},
  };

  // Extract dimensions with proper typing
  if (datasetAny.dimensions) {
    for (const [name, dimension] of Object.entries(datasetAny.dimensions)) {
      const dimSchema: DimensionSchema = {
        type: (dimension as { type?: string }).type || 'unknown',
        column: (dimension as { column?: string }).column || name,
        label: (dimension as { label?: string }).label || name,
        description: (dimension as { description?: string }).description || '',
        examples: (dimension as { examples?: string[] }).examples || [],
      };
      schema.dimensions[name] = dimSchema;
    }
  }

  // Extract metrics with proper typing
  if (datasetAny.metrics) {
    for (const [name, metric] of Object.entries(datasetAny.metrics)) {
      const metSchema: MetricSchema = {
        type: (metric as { type?: string }).type || 'unknown',
        aggregation: (metric as { aggregation?: string; type?: string }).aggregation || (metric as { type?: string }).type || '',
        label: (metric as { label?: string }).label || name,
        description: (metric as { description?: string }).description || '',
        format: (metric as { format?: string }).format || null,
      };
      schema.metrics[name] = metSchema;
    }
  }

  // Extract relationships with proper typing
  if (datasetAny.relationships) {
    for (const [name, relationship] of Object.entries(datasetAny.relationships)) {
      const rel = relationship as any;
      const relSchema: RelationshipSchema = {
        type: rel.type || rel.kind || 'unknown',
        target: typeof rel.target === 'function' ? rel.target()?.name || '' : rel.target || rel.dataset?.name || '',
        description: rel.description || '',
      };
      schema.relationships[name] = relSchema;
    }
  }

  return {
    content: [
      {
        type: 'text' as const,
        text: JSON.stringify(schema, null, 2),
      },
    ],
  };
}
