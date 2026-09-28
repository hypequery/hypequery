/**
 * dataset() — creates a typed semantic model over a physical table.
 *
 * Relationships are modeled on the dataset. To-one relationships (`belongsTo`,
 * `hasOne`) are queryable one hop deep as `<relationship>.<dimension>` and
 * execute as LEFT JOINs; `hasMany` relationships remain metadata-only to avoid
 * fan-out corrupting aggregates.
 *
 * @example
 * ```ts
 * import { dataset, dimension, measure, belongsTo } from '@hypequery/serve';
 *
 * const Orders = dataset("orders", {
 *   source: "orders",
 *   tenantKey: "tenant_id",
 *   timeKey: "created_at",
 *   dimensions: {
 *     id: dimension.string(),
 *     status: dimension.string({ label: "Order Status" }),
 *     createdAt: dimension.timestamp({ column: "created_at" }),
 *   },
 *   measures: {
 *     totalRevenue: measure.sum("amount", { label: "Total Revenue" }),
 *     orderCount: measure.count("id"),
 *   },
 *   relationships: {
 *     customer: belongsTo(() => Customers, { from: "customerId", to: "id" }),
 *   },
 * });
 * ```
 */

import type {
  DatasetConfig,
  DatasetInstance,
  DatasetMeasureDefinition,
  BaseMeasures,
  DerivedMeasures,
  DimensionDefinition,
  RelationshipDefinition,
  BaseMetricRef,
  DerivedMetricRef,
  BaseMetricConfig,
  DerivedMetricConfig,
  SegmentDefinition,
} from './types.js';
import {
  createDerivedMetricSpec,
  createMetricRef,
  isDerivedMetricConfig,
} from './utils/dataset-metric-ref.js';
import {
  measureToAggregationSpec,
  normalizeDimensions,
  normalizeFilters,
  normalizeRelationships,
} from './utils/dataset-normalization.js';
import {
  validateBaseMetric,
  validateDerivedMetric,
} from './utils/dataset-validation.js';
import { validateDatasetDefinition } from './utils/dataset-definition-validation.js';
import { snapshotSemanticMetadata } from './utils/semantic-metadata.js';
import { validateSemanticMetadata } from './utils/semantic-metadata-validation.js';
import { derivedMeasuresView, getBaseMeasure } from './utils/dataset-measures.js';
import { normalizeSegments } from './utils/segments.js';

export function dataset<
  TDatasetName extends string,
  TDimensions extends Record<string, DimensionDefinition>,
  TDefinitions extends Record<string, DatasetMeasureDefinition> = {},
  TRelationships extends Record<string, RelationshipDefinition> = Record<string, never>,
  const TSegments extends Record<string, SegmentDefinition> = {},
>(
  name: TDatasetName,
  config: DatasetConfig<TDimensions, TDefinitions, TRelationships, TSegments>,
): DatasetInstance<TDimensions, TDefinitions, TRelationships, TDatasetName, DerivedMeasures<TDefinitions>, TSegments> {
  // Structural validation runs before anything is normalized, so an invalid
  // model fails at definition time rather than on the first query that reaches
  // the broken part of it.
  validateDatasetDefinition(name, config);

  const dimensions = normalizeDimensions(config);
  // The spread copies the authored keys, but TypeScript widens them through
  // CheckedDatasetMeasures. Preserve their literal names and definition types.
  const measures = { ...config.measures } as TDefinitions;
  const filters = normalizeFilters(dimensions, config.filters);
  const relationships = normalizeRelationships(config.relationships, config.source);

  type TMeasures = BaseMeasures<TDefinitions>;
  type ThisDataset = DatasetInstance<TDimensions, TDefinitions, TRelationships, TDatasetName, DerivedMeasures<TDefinitions>, TSegments>;
  function metric<TName extends string>(
    metricName: TName,
    metricConfig: BaseMetricConfig<TMeasures>,
  ): BaseMetricRef<TDatasetName, TName, ThisDataset>;
  function metric<TName extends string>(
    metricName: TName,
    metricConfig: DerivedMetricConfig<TDatasetName>,
  ): DerivedMetricRef<TDatasetName, TName, ThisDataset>;
  function metric<TName extends string>(
    metricName: TName,
    metricConfig: BaseMetricConfig<TMeasures> | DerivedMetricConfig<TDatasetName>,
  ): BaseMetricRef<TDatasetName, TName, ThisDataset> | DerivedMetricRef<TDatasetName, TName, ThisDataset> {
    validateSemanticMetadata(ds.name, `metrics.${metricName}`, metricConfig);
    if (isDerivedMetricConfig(metricConfig)) {
      validateDerivedMetric(ds, metricName, metricConfig);
      const derivedSpec = createDerivedMetricSpec(metricConfig);
      return createMetricRef(
        ds, metricName, derivedSpec,
        metricConfig.label, metricConfig.description, metricConfig,
      );
    }

    const measureName = metricConfig.measure;
    const measure = getBaseMeasure(ds.measures, measureName);
    if (!measure) {
      if (Object.hasOwn(ds.measures, measureName)) {
        throw new Error(`Invalid metric "${metricName}": measure "${measureName}" must be a base measure.`);
      }
      throw new Error(
        `Invalid metric "${metricName}": measure "${measureName}" does not exist on dataset "${ds.name}".`,
      );
    }
    const spec = measureToAggregationSpec(measureName, measure);
    validateBaseMetric(ds, metricName, spec, { allowHiddenField: true });
    return createMetricRef(
      ds, metricName, spec,
      metricConfig.label ?? measure.label,
      metricConfig.description ?? measure.description,
      { ...measure, ...metricConfig },
    );
  }

  const ds: ThisDataset = {
    __type: 'dataset',
    name,
    source: config.source,
    description: config.description,
    ...snapshotSemanticMetadata(config),
    freshness: config.freshness === undefined ? undefined : { ...config.freshness },
    owner: config.owner,
    defaults: config.defaults === undefined ? undefined : {
      ...config.defaults,
      ...(config.defaults.dimensions === undefined ? {} : { dimensions: [...config.defaults.dimensions] }),
    },
    tenantKey: config.tenantKey,
    timeKey: config.timeKey,
    ...(config.timeGrains === undefined ? {} : { timeGrains: Object.freeze([...config.timeGrains]) }),
    dimensions,
    measures,
    derivedMeasures: derivedMeasuresView(measures),
    filters,
    relationships,
    limits: config.limits,
    cache: config.cache,
    segments: normalizeSegments(name, { tenantKey: config.tenantKey, dimensions }, config.segments) as TSegments,
    metric,
  };

  return ds;
}
