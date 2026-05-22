/**
 * dataset() — creates a typed semantic model over a physical table.
 *
 * Relationships are modeled on the dataset today, but current query execution
 * only supports same-dataset dimensions, measures, and metrics. Joined
 * relationship traversal is not part of the shipped execution surface yet.
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
  DimensionDefinition,
  MeasureDefinition,
  RelationshipDefinition,
  BaseMetricRef,
  DerivedMetricRef,
  BaseMetricConfig,
  DerivedMetricConfig,
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
  normalizeMeasures,
  normalizeRelationships,
} from './utils/dataset-normalization.js';
import {
  validateBaseMetric,
  validateDerivedMetric,
} from './utils/dataset-validation.js';

export function dataset<
  TDatasetName extends string,
  TDimensions extends Record<string, DimensionDefinition>,
  TMeasures extends Record<string, MeasureDefinition> = Record<string, never>,
  TRelationships extends Record<string, RelationshipDefinition> = Record<string, never>,
>(
  name: TDatasetName,
  config: DatasetConfig<TDimensions, TMeasures, TRelationships>,
): DatasetInstance<TDimensions, TMeasures, TRelationships, TDatasetName> {
  const dimensions = normalizeDimensions(config);
  const measures = normalizeMeasures(config.measures);
  const filters = normalizeFilters(dimensions, config.filters);
  const relationships = normalizeRelationships(config.relationships);

  function metric<TName extends string>(
    metricName: TName,
    metricConfig: BaseMetricConfig<TDimensions, TMeasures>,
  ): BaseMetricRef<TDatasetName, TName>;
  function metric<TName extends string>(
    metricName: TName,
    metricConfig: DerivedMetricConfig<TDatasetName>,
  ): DerivedMetricRef<TDatasetName, TName>;
  function metric<TName extends string>(
    metricName: TName,
    metricConfig: BaseMetricConfig<TDimensions, TMeasures> | DerivedMetricConfig<TDatasetName>,
  ): BaseMetricRef<TDatasetName, TName> | DerivedMetricRef<TDatasetName, TName> {
    if (isDerivedMetricConfig(metricConfig)) {
      validateDerivedMetric(ds, metricName, metricConfig);
      const derivedSpec = createDerivedMetricSpec(metricConfig);
      return createMetricRef(
        ds, metricName, derivedSpec,
        metricConfig.label, metricConfig.description,
      );
    }

    const measureName = metricConfig.measure;
    const measure = ds.measures[measureName];
    if (!measure) {
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
    );
  }

  const ds: DatasetInstance<TDimensions, TMeasures, TRelationships, TDatasetName> = {
    __type: 'dataset',
    name,
    source: config.source,
    tenantKey: config.tenantKey,
    timeKey: config.timeKey,
    dimensions,
    measures,
    filters,
    relationships,
    limits: config.limits,
    metric,
  };

  return ds;
}
