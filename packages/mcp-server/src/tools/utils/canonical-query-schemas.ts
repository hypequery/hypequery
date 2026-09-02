import { createHash } from 'node:crypto';
import {
  buildCanonicalSemanticQuerySchemas,
  toSemanticJsonSchema,
  type CanonicalSemanticQuerySchemas,
  type DatasetCatalogSource,
} from '@hypequery/datasets';
import { z, type ZodTypeAny } from 'zod';
import type { DatasetRegistry, MCPQueryLimits } from '../../types.js';
import { queryDatasetArgsSchema, queryMetricArgsSchema } from '../args.js';
import { resolveQueryLimits } from './query-limits.js';
import { advertiseDatasetQueryLimits } from './query-schema.js';

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
  configured?: MCPQueryLimits,
): CanonicalSemanticQuerySchemas {
  const limits = resolveQueryLimits(undefined, configured);
  const entries = Object.entries(datasets).sort(([left], [right]) => (
    left < right ? -1 : left > right ? 1 : 0
  ));

  if (entries.length === 0) {
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

  const datasetSchemas: ZodTypeAny[] = [];
  const metricSchemas: ZodTypeAny[] = [];
  const datasetJsonSchemas: CanonicalSemanticQuerySchemas['queryDatasetJsonSchema'][] = [];
  const metricJsonSchemas: CanonicalSemanticQuerySchemas['queryMetricJsonSchema'][] = [];

  for (const [name, dataset] of entries) {
    if (isCanonicalSchemaSource(dataset)) {
      const exact = buildCanonicalSemanticQuerySchemas(
        withLegacyDirectMetrics({ [name]: dataset }),
        { grainField: 'grain', ...limits },
      );
      datasetSchemas.push(exact.queryDataset);
      metricSchemas.push(exact.queryMetric);
      datasetJsonSchemas.push(exact.queryDatasetJsonSchema);
      metricJsonSchemas.push(exact.queryMetricJsonSchema);
    } else {
      // Keep compatibility local to the legacy entry. A registry-wide fallback
      // would erase exact contracts for every valid Dataset beside it.
      const queryDataset = queryDatasetArgsSchema.extend({ dataset: z.literal(name) });
      const queryMetric = queryMetricArgsSchema.extend({
        dataset: z.literal(name),
        metric: z.string().min(1),
      });
      datasetSchemas.push(queryDataset);
      metricSchemas.push(queryMetric);
      datasetJsonSchemas.push(advertiseDatasetQueryLimits(
        toSemanticJsonSchema(queryDataset),
        { [name]: dataset },
        configured,
        true,
      ));
      metricJsonSchemas.push(advertiseDatasetQueryLimits(
        toSemanticJsonSchema(queryMetric),
        { [name]: dataset },
        configured,
        false,
      ));
    }
  }

  const queryDataset = unionSchemas(datasetSchemas);
  const queryMetric = unionSchemas(metricSchemas);
  const queryDatasetJsonSchema = unionJsonSchemas(datasetJsonSchemas);
  const queryMetricJsonSchema = unionJsonSchemas(metricJsonSchemas);
  const manifestHash = createHash('sha256').update(JSON.stringify({
    query_dataset: queryDatasetJsonSchema,
    query_metric: queryMetricJsonSchema,
  })).digest('hex');

  return Object.freeze({
    queryDataset,
    queryMetric,
    queryDatasetJsonSchema,
    queryMetricJsonSchema,
    manifestHash,
  });
}

function isCanonicalSchemaSource(dataset: unknown): dataset is DatasetCatalogSource {
  if (!dataset || typeof dataset !== 'object') return false;
  const source = dataset as Record<string, unknown>;
  return source.__type === 'dataset'
    || ('requiresTenant' in source && 'supportedGrains' in source && 'orderableFields' in source);
}

function unionSchemas(schemas: ZodTypeAny[]): ZodTypeAny {
  return schemas.length === 1
    ? schemas[0]
    : z.union(schemas as [ZodTypeAny, ZodTypeAny, ...ZodTypeAny[]]);
}

function unionJsonSchemas(
  schemas: CanonicalSemanticQuerySchemas['queryDatasetJsonSchema'][],
): CanonicalSemanticQuerySchemas['queryDatasetJsonSchema'] {
  return schemas.length === 1
    ? schemas[0]
    : { type: 'object', anyOf: schemas };
}
