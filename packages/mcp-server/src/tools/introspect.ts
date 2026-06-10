/**
 * Get Dataset Schema Tool
 *
 * Returns the complete schema for a dataset including dimensions, metrics,
 * and relationships.
 */

import type {
  DatasetRegistry,
  GetDatasetSchemaArgs,
  MCPToolResponse,
  DatasetSchema,
  DimensionSchema,
  MetricSchema,
  RelationshipSchema,
} from '../types.js';
import { resolveDataset, textResponse } from './dataset-access.js';

export async function getDatasetSchemaTool(
  datasets: DatasetRegistry,
  args: unknown
): Promise<MCPToolResponse> {
  const { dataset: datasetName } = (args ?? {}) as GetDatasetSchemaArgs;
  const dataset = resolveDataset(datasets, datasetName);

  const schema: DatasetSchema = {
    name: datasetName,
    description: dataset.description || dataset.config?.description || '',
    source: dataset.source || dataset.config?.source || '',
    timeKey: dataset.timeKey || dataset.config?.timeKey || null,
    tenantKey: dataset.tenantKey || dataset.config?.tenantKey || null,
    dimensions: {},
    metrics: {},
    relationships: {},
  };

  if (dataset.dimensions) {
    for (const [name, dimension] of Object.entries(dataset.dimensions)) {
      const dimSchema: DimensionSchema = {
        type: dimension.fieldType || dimension.type || 'unknown',
        column: dimension.column || name,
        label: dimension.label || name,
        description: dimension.description || '',
        examples: dimension.examples || [],
      };
      schema.dimensions[name] = dimSchema;
    }
  }

  // DatasetInstance objects store metrics under `measures`; plain config
  // objects use `metrics`. Read whichever is present.
  const metrics = dataset.metrics ?? dataset.measures;
  if (metrics) {
    for (const [name, metric] of Object.entries(metrics)) {
      const metSchema: MetricSchema = {
        type: metric.spec?.__type || metric.type || 'unknown',
        aggregation: metric.spec?.aggregation || metric.aggregation || metric.type || '',
        label: metric.label || name,
        description: metric.description || '',
        format: metric.format || null,
      };
      schema.metrics[name] = metSchema;
    }
  }

  if (dataset.relationships) {
    for (const [name, rel] of Object.entries(dataset.relationships)) {
      const target =
        typeof rel.target === 'function'
          ? rel.target()?.name || ''
          : rel.target || rel.dataset?.name || '';
      const relSchema: RelationshipSchema = {
        type: rel.type || rel.kind || 'unknown',
        target,
        description: rel.description || '',
      };
      schema.relationships[name] = relSchema;
    }
  }

  return textResponse(schema);
}
