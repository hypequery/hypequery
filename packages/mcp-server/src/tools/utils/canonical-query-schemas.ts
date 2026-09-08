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
  /**
   * Datasets offered as a `query_dataset` target. Defaults to all of them.
   *
   * A dataset outside this list keeps its metrics and its joins; it is only
   * withheld as a direct target, which a hosted gateway needs when a caller is
   * entitled to a metric on a dataset it may not query itself.
   */
  queryableDatasets?: readonly string[],
): CanonicalSemanticQuerySchemas {
  const limits = resolveQueryLimits(undefined, configured);
  const queryable = queryableDatasets === undefined ? undefined : new Set(queryableDatasets);
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

  if (entries.every(([, dataset]) => isCanonicalSchemaSource(dataset))) {
    return buildCanonicalSemanticQuerySchemas(
      withLegacyDirectMetrics(datasets),
      {
        grainField: 'grain',
        ...limits,
        ...(queryableDatasets === undefined ? {} : { queryableDatasets }),
      },
    );
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
      if (queryable === undefined || queryable.has(name)) {
        datasetSchemas.push(exact.queryDataset);
        datasetJsonSchemas.push(exact.queryDatasetJsonSchema);
      }
      metricSchemas.push(exact.queryMetric);
      metricJsonSchemas.push(exact.queryMetricJsonSchema);
    } else {
      // Keep compatibility local to the legacy entry. A registry-wide fallback
      // would erase exact contracts for every valid Dataset beside it.
      const queryDataset = queryDatasetArgsSchema.extend({ dataset: z.literal(name) });
      const queryMetric = queryMetricArgsSchema.extend({
        dataset: z.literal(name),
        metric: z.string().min(1),
      });
      if (queryable === undefined || queryable.has(name)) {
        datasetSchemas.push(queryDataset);
        datasetJsonSchemas.push(advertiseDatasetQueryLimits(
          toSemanticJsonSchema(queryDataset),
          { [name]: dataset },
          configured,
          true,
        ));
      }
      metricSchemas.push(queryMetric);
      metricJsonSchemas.push(advertiseDatasetQueryLimits(
        toSemanticJsonSchema(queryMetric),
        { [name]: dataset },
        configured,
        false,
      ));
    }
  }

  const queryDataset = unionSchemas(datasetSchemas, z.object({ dataset: z.never() }).strict());
  const queryMetric = unionSchemas(
    metricSchemas,
    z.object({ dataset: z.never(), metric: z.never() }).strict(),
  );
  const queryDatasetJsonSchema = unionJsonSchemas(
    datasetJsonSchemas, toSemanticJsonSchema(queryDataset),
  );
  const queryMetricJsonSchema = unionJsonSchemas(
    metricJsonSchemas, toSemanticJsonSchema(queryMetric),
  );
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

function unionSchemas(schemas: ZodTypeAny[], empty: ZodTypeAny): ZodTypeAny {
  // No variants means nothing is offered under this tool. `z.union([])` throws,
  // and a permissive fallback would advertise every dataset instead of none.
  if (schemas.length === 0) return empty;
  return schemas.length === 1
    ? schemas[0]
    : z.union(schemas as [ZodTypeAny, ZodTypeAny, ...ZodTypeAny[]]);
}

function unionJsonSchemas(
  schemas: CanonicalSemanticQuerySchemas['queryDatasetJsonSchema'][],
  empty: CanonicalSemanticQuerySchemas['queryDatasetJsonSchema'],
): CanonicalSemanticQuerySchemas['queryDatasetJsonSchema'] {
  if (schemas.length === 0) return empty;
  return schemas.length === 1
    ? schemas[0]
    : { type: 'object', anyOf: schemas };
}
