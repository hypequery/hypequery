import { createHash } from 'node:crypto';
import {
  buildCanonicalSemanticQuerySchemas,
  toSemanticJsonSchema,
  type CanonicalSemanticQuerySchemas,
  type DatasetCatalogSource,
} from '@hypequery/datasets';
import type { DatasetRegistry } from '../../types.js';
import { queryDatasetArgsSchema, queryMetricArgsSchema } from '../args.js';

function withLegacyDirectMetrics(
  datasets: DatasetRegistry,
): Record<string, DatasetCatalogSource> {
  return Object.fromEntries(Object.entries(datasets).map(([name, dataset]) => {
    if (!dataset || typeof dataset !== 'object') return [name, dataset];
    const directMetrics = Object.fromEntries(Object.entries(dataset).filter(([, value]) => (
      value && typeof value === 'object' && 'contract' in value
      && typeof (value as { contract?: unknown }).contract === 'function'
    )));
    return [name, {
      ...dataset,
      metrics: {
        ...('metrics' in dataset && dataset.metrics && typeof dataset.metrics === 'object'
          ? dataset.metrics
          : {}),
        ...directMetrics,
      },
    }];
  })) as Record<string, DatasetCatalogSource>;
}

/**
 * Compile exact schemas for real Dataset registries. The shipped loose registry
 * type also accepts legacy metadata-only objects; retain a generic validator for
 * those compatibility inputs until the publishing API replaces them.
 */
export function buildMCPQuerySchemas(
  datasets: DatasetRegistry,
): CanonicalSemanticQuerySchemas {
  try {
    if (Object.keys(datasets).length === 0) {
      throw new Error('Legacy or empty Dataset registry');
    }
    return buildCanonicalSemanticQuerySchemas(
      withLegacyDirectMetrics(datasets),
      { grainField: 'grain' },
    );
  } catch {
    const queryDatasetJsonSchema = toSemanticJsonSchema(queryDatasetArgsSchema);
    const queryMetricJsonSchema = toSemanticJsonSchema(queryMetricArgsSchema);
    const manifestHash = createHash('sha256').update(JSON.stringify({
      query_dataset: queryDatasetJsonSchema,
      query_metric: queryMetricJsonSchema,
    })).digest('hex');
    return Object.freeze({
      queryDataset: queryDatasetArgsSchema,
      queryMetric: queryMetricArgsSchema,
      queryDatasetJsonSchema,
      queryMetricJsonSchema,
      manifestHash,
    });
  }
}
