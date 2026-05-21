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
  AnyDatasetInstance,
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
  SemanticFiltersDefinition,
} from './types.js';
import { validateFilterValue } from './validation.js';

const ALL_GRAINS: TimeGrain[] = ['day', 'week', 'month', 'quarter', 'year'];
const NUMERIC_FIELD_TYPES = new Set(['number']);
type AnyDimensions = Record<string, DimensionDefinition>;
type AnyMeasures = Record<string, MeasureDefinition>;
type AnyRelationships = Record<string, RelationshipDefinition>;
type DatasetShape = AnyDatasetInstance;

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
  ds: DatasetShape,
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
  ds: DatasetShape,
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
  ds: DatasetShape,
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

  for (const filter of spec.filters ?? []) {
    const filterDefinition = ds.filters[filter.field];
    const resolvedField = filterDefinition?.field ?? filter.field;
    const fieldType = ds.dimensions[resolvedField]?.fieldType;

    if (!fieldType) {
      throw new Error(
        `Invalid metric "${metricName}": measure filter field "${filter.field}" does not exist on dataset "${ds.name}".`,
      );
    }

    if (filterDefinition?.operators && !filterDefinition.operators.includes(filter.operator)) {
      throw new Error(
        `Invalid metric "${metricName}": measure filter "${filter.field}" does not allow operator "${filter.operator}".`,
      );
    }

    const filterError = validateFilterValue(filter, fieldType);
    if (filterError) {
      throw new Error(`Invalid metric "${metricName}": ${filterError}`);
    }
  }
}

function validateDerivedMetric(
  ds: DatasetShape,
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
  config: DatasetConfig<TDimensions, AnyMeasures, AnyRelationships>,
): TDimensions {
  return config.dimensions as TDimensions;
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
    filters: definition.filters,
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
    measures,
    filters,
    relationships: (config.relationships ?? {}) as TRelationships,
    limits: config.limits,

    metric<TName extends string>(
      metricName: TName,
      metricConfig: BaseMetricConfig<TDimensions, TMeasures> | DerivedMetricConfig,
    ): MetricRef<string, TName> {
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

      // Base metric (measure-based)
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
  };

  return ds;
}
