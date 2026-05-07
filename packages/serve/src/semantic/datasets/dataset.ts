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
  MetricRef,
  MetricContract,
  GrainedMetricRef,
  AggregationSpec,
  DerivedMetricSpec,
  BaseMetricConfig,
  DerivedMetricConfig,
  TimeGrain,
  DatasetQueryConfig,
  DatasetQueryRef,
  SemanticFiltersDefinition,
} from './types.js';

const ALL_GRAINS: TimeGrain[] = ['day', 'week', 'month', 'quarter', 'year'];
const NUMERIC_FIELD_TYPES = new Set(['number']);

function isBaseMetricConfig<
  TDimensions extends Record<string, DimensionDefinition>,
  TMeasures extends Record<string, MeasureDefinition>,
>(
  config: BaseMetricConfig<TDimensions, TMeasures> | DerivedMetricConfig,
): config is BaseMetricConfig<TDimensions, TMeasures> {
  return 'value' in config || 'measure' in config;
}

function isDerivedMetricConfig<
  TDimensions extends Record<string, DimensionDefinition>,
  TMeasures extends Record<string, MeasureDefinition>,
>(
  config: BaseMetricConfig<TDimensions, TMeasures> | DerivedMetricConfig,
): config is DerivedMetricConfig {
  return 'uses' in config && 'formula' in config;
}

function buildContract(
  metricName: string,
  ds: DatasetInstance<any, any, any>,
  spec: AggregationSpec | DerivedMetricSpec,
  label?: string,
  description?: string,
  grain?: TimeGrain,
): MetricContract {
  const dimensionNames = Object.keys(ds.dimensions);
  const measureNames = Object.keys(ds.measures);
  const filterNames = Object.keys(ds.filters).length > 0
    ? Object.keys(ds.filters)
    : dimensionNames.filter((name) => ds.dimensions[name]?.filterable !== false);
  const kind = grain
    ? 'grained_metric'
    : spec.__type === 'derived_metric_spec'
      ? 'derived_metric'
      : 'metric';

  return {
    kind,
    name: metricName,
    dataset: ds.name,
    valueType: 'number',
    label,
    description,
    dimensions: dimensionNames,
    measures: measureNames,
    filters: filterNames,
    grains: ds.timeKey ? ALL_GRAINS : [],
    grain,
    requires: spec.__type === 'derived_metric_spec'
      ? Object.keys(spec.uses)
      : undefined,
    tenantScoped: !!ds.tenantKey,
  };
}

function createMetricRef(
  ds: DatasetInstance<any, any, any>,
  name: string,
  spec: AggregationSpec | DerivedMetricSpec,
  label?: string,
  description?: string,
): MetricRef {
  const ref: MetricRef = {
    __type: 'metric_ref',
    datasetName: ds.name,
    name,
    spec,
    label,
    description,
    dataset: ds,

    by(grain: TimeGrain): GrainedMetricRef {
      if (!ds.timeKey) {
        throw new Error(
          `Cannot apply .by("${grain}") to metric "${name}" — ` +
          `dataset "${ds.name}" has no timeKey defined.`,
        );
      }
      return {
        __type: 'grained_metric_ref',
        metric: ref,
        grain,
        contract() {
          return buildContract(name, ds, spec, label, description, grain);
        },
      };
    },

    contract() {
      return buildContract(name, ds, spec, label, description);
    },
  };

  return ref;
}

function validateBaseMetric(
  ds: DatasetInstance<any, any, any>,
  metricName: string,
  spec: AggregationSpec,
  options?: { allowHiddenField?: boolean },
): void {
  const dimension = ds.dimensions[spec.field];
  if (!dimension && !options?.allowHiddenField) {
    throw new Error(
      `Invalid metric "${metricName}": dimension "${spec.field}" does not exist on dataset "${ds.name}".`,
    );
  }

  if (
    dimension &&
    (spec.aggregation === 'sum' || spec.aggregation === 'avg') &&
    !NUMERIC_FIELD_TYPES.has(dimension.fieldType)
  ) {
    throw new Error(
      `Invalid metric "${metricName}": ${spec.aggregation}() requires a numeric dimension, but "${spec.field}" is ${dimension.fieldType}.`,
    );
  }
}

function validateDerivedMetric(
  ds: DatasetInstance<any, any, any>,
  metricName: string,
  config: DerivedMetricConfig,
): void {
  const usedMetrics = Object.entries(config.uses);
  if (usedMetrics.length === 0) {
    throw new Error(`Invalid metric "${metricName}": derived metrics must reference at least one base metric.`);
  }

  for (const [alias, metric] of usedMetrics) {
    if (metric.datasetName !== ds.name) {
      throw new Error(
        `Invalid metric "${metricName}": referenced metric "${alias}" belongs to dataset "${metric.datasetName}", expected "${ds.name}".`,
      );
    }

    if (metric.spec.__type !== 'aggregation_spec') {
      throw new Error(
        `Invalid metric "${metricName}": referenced metric "${alias}" must be a base aggregation on dataset "${ds.name}".`,
      );
    }
  }
}

function normalizeDimensions<TDimensions extends Record<string, DimensionDefinition>>(
  config: DatasetConfig<TDimensions, any, any>,
): TDimensions {
  const dimensions = config.dimensions ?? config.fields;
  if (!dimensions) {
    throw new Error('dataset() requires a `dimensions` definition.');
  }
  return dimensions as TDimensions;
}

function normalizeFilters(
  dimensions: Record<string, DimensionDefinition>,
  filters?: SemanticFiltersDefinition,
): SemanticFiltersDefinition {
  if (filters) {
    return filters;
  }

  return Object.fromEntries(
    Object.entries(dimensions)
      .filter(([, definition]) => definition.filterable !== false)
      .map(([name]) => [
        name,
        {
          __type: 'filter_definition' as const,
          field: name,
        },
      ]),
  );
}

function measureToAggregationSpec(
  measureName: string,
  definition: MeasureDefinition,
): AggregationSpec {
  if (!definition.field) {
    throw new Error(`Invalid measure "${measureName}": a backing field is required.`);
  }
  return {
    __type: 'aggregation_spec',
    aggregation: definition.aggregation,
    field: definition.field,
  };
}

function buildDatasetQueryContract(
  ds: DatasetInstance<any, any, any>,
  config: DatasetQueryConfig<any, any>,
) {
  return {
    dataset: ds.name,
    dimensions: config.dimensions ? [...config.dimensions] : Object.keys(ds.dimensions),
    measures: config.measures ? [...config.measures] : Object.keys(ds.measures),
    filters: Object.keys(ds.filters),
    grains: ds.timeKey ? ALL_GRAINS : [],
    tenantScoped: !!ds.tenantKey,
  };
}

export function dataset<
  TDimensions extends Record<string, DimensionDefinition>,
  TMeasures extends Record<string, MeasureDefinition> = Record<string, never>,
  TRelationships extends Record<string, RelationshipDefinition> = Record<string, never>,
>(
  name: string,
  config: DatasetConfig<TDimensions, TMeasures, TRelationships>,
): DatasetInstance<TDimensions, TMeasures, TRelationships> {
  const dimensions = normalizeDimensions(config);
  const measures = (config.measures ?? {}) as TMeasures;
  const filters = normalizeFilters(dimensions, config.filters);

  const ds: DatasetInstance<TDimensions, TMeasures, TRelationships> = {
    __type: 'dataset',
    name,
    source: config.source,
    tenantKey: config.tenantKey,
    timeKey: config.timeKey,
    dimensions,
    fields: dimensions,
    measures,
    filters,
    relationships: (config.relationships ?? {}) as TRelationships,
    limits: config.limits,

    metric<TName extends string>(
      metricName: TName,
      metricConfig: BaseMetricConfig<TDimensions, TMeasures> | DerivedMetricConfig,
    ): MetricRef<string, TName> {
      if ('measure' in metricConfig && metricConfig.measure) {
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
        ) as MetricRef<string, TName>;
      }

      if (isBaseMetricConfig(metricConfig) && metricConfig.value) {
        validateBaseMetric(ds, metricName, metricConfig.value);
        return createMetricRef(
          ds, metricName, metricConfig.value,
          metricConfig.label, metricConfig.description,
        ) as MetricRef<string, TName>;
      }

      if (isDerivedMetricConfig(metricConfig)) {
        validateDerivedMetric(ds, metricName, metricConfig);
        const derivedSpec: DerivedMetricSpec = {
          __type: 'derived_metric_spec',
          uses: metricConfig.uses,
          formula: metricConfig.formula,
        };
        return createMetricRef(
          ds, metricName, derivedSpec,
          metricConfig.label, metricConfig.description,
        ) as MetricRef<string, TName>;
      }

      throw new Error(
        `Invalid metric config for "${metricName}". ` +
        `Expected either { value: sum(...) } or { uses: ..., formula: ... }.`,
      );
    },

    query(queryConfig: DatasetQueryConfig<TDimensions, TMeasures>): DatasetQueryRef<TDimensions, TMeasures> {
      return {
        __type: 'dataset_query_ref',
        dataset: ds,
        config: queryConfig,
        contract() {
          return buildDatasetQueryContract(ds, queryConfig);
        },
      };
    }
  };

  return ds;
}
