import { createHash } from 'node:crypto';
import type { DatasetCatalogSource } from '@hypequery/datasets';
import {
  buildCanonicalSemanticQuerySchemas,
  toSemanticJsonSchema,
  type CanonicalSemanticQuerySchemas,
} from '@hypequery/datasets/schemas';
import { z, type ZodTypeAny } from 'zod';
import type { DatasetRegistry, MCPQueryFeatures, MCPQueryLimits } from '../../types.js';
import { queryDatasetArgsSchema, queryMetricArgsSchema } from '../args.js';
import { resolveQueryLimits } from './query-limits.js';
import { advertiseDatasetQueryLimits } from './query-schema.js';
import { hoistDefinitions } from './json-schema-definitions.js';
import { semanticQueryFeatureOptions } from './query-features.js';

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
  /**
   * The analysis features to advertise and accept; each defaults to on. CORE-03
   * requires the hosted gateway to list exactly what the local executor runs,
   * so a host turns a feature off only when its executor cannot run it.
   */
  features: MCPQueryFeatures = {},
): CanonicalSemanticQuerySchemas {
  const featureOptions = semanticQueryFeatureOptions(features);
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
        ...featureOptions,
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
        { grainField: 'grain', ...limits, ...featureOptions },
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
  // Each exact schema was compiled alone, so their definitions are renamed
  // apart before they share one document.
  const queryDatasetJsonSchema = unionJsonSchemas(
    datasetJsonSchemas.map((schema, index) => hoistDefinitions(schema, `d${index}_`)),
    toSemanticJsonSchema(queryDataset),
  );
  const queryMetricJsonSchema = unionJsonSchemas(
    metricJsonSchemas.map((schema, index) => hoistDefinitions(schema, `m${index}_`)),
    toSemanticJsonSchema(queryMetric),
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
  hoisted: ReturnType<typeof hoistDefinitions>[],
  empty: CanonicalSemanticQuerySchemas['queryDatasetJsonSchema'],
): CanonicalSemanticQuerySchemas['queryDatasetJsonSchema'] {
  if (hoisted.length === 0) return empty;
  const definitions = Object.assign({}, ...hoisted.map(item => item.definitions));
  const schemas = hoisted.map(item => item.schema);
  const union = schemas.length === 1 ? schemas[0] : { type: 'object', anyOf: schemas };
  return Object.keys(definitions).length === 0 ? union : { ...union, definitions };
}
