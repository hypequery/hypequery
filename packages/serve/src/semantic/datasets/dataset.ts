/**
 * dataset() — creates a typed data contract over a physical table.
 *
 * @example
 * ```ts
 * import { dataset, field, belongsTo } from '@hypequery/serve';
 *
 * const Orders = dataset("orders", {
 *   source: "orders",
 *   tenantKey: "tenant_id",
 *   timeKey: "created_at",
 *   fields: {
 *     id: field.string(),
 *     amount: field.number({ label: "Amount" }),
 *     status: field.string({ label: "Order Status" }),
 *     createdAt: field.timestamp(),
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
  FieldDefinition,
  RelationshipDefinition,
  MetricRef,
  MetricContract,
  GrainedMetricRef,
  AggregationSpec,
  DerivedMetricSpec,
  BaseMetricConfig,
  DerivedMetricConfig,
  TimeGrain,
} from './types.js';

const ALL_GRAINS: TimeGrain[] = ['day', 'week', 'month', 'quarter', 'year'];

function isBaseMetricConfig(config: BaseMetricConfig | DerivedMetricConfig): config is BaseMetricConfig {
  return 'value' in config && (config as BaseMetricConfig).value?.__type === 'aggregation_spec';
}

function isDerivedMetricConfig(config: BaseMetricConfig | DerivedMetricConfig): config is DerivedMetricConfig {
  return 'uses' in config && 'formula' in config;
}

function buildContract(
  metricName: string,
  ds: DatasetInstance<any>,
  spec: AggregationSpec | DerivedMetricSpec,
  label?: string,
  description?: string,
  grain?: TimeGrain,
): MetricContract {
  const fieldNames = Object.keys(ds.fields);
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
    dimensions: fieldNames,
    filters: fieldNames,
    grains: ds.timeKey ? ALL_GRAINS : [],
    grain,
    requires: spec.__type === 'derived_metric_spec'
      ? Object.keys(spec.uses)
      : undefined,
    tenantScoped: !!ds.tenantKey,
  };
}

function createMetricRef(
  ds: DatasetInstance<any>,
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

export function dataset<
  TFields extends Record<string, FieldDefinition>,
  TRelationships extends Record<string, RelationshipDefinition> = Record<string, never>,
>(
  name: string,
  config: DatasetConfig<TFields, TRelationships>,
): DatasetInstance<TFields> {
  const ds: DatasetInstance<TFields> = {
    __type: 'dataset',
    name,
    source: config.source,
    tenantKey: config.tenantKey,
    timeKey: config.timeKey,
    fields: config.fields,
    relationships: (config.relationships ?? {}) as Record<string, RelationshipDefinition>,
    limits: config.limits,

    metric<TName extends string>(
      metricName: TName,
      metricConfig: BaseMetricConfig<TFields> | DerivedMetricConfig,
    ): MetricRef<string, TName> {
      if (isBaseMetricConfig(metricConfig)) {
        return createMetricRef(
          ds, metricName, metricConfig.value,
          metricConfig.label, metricConfig.description,
        ) as MetricRef<string, TName>;
      }

      if (isDerivedMetricConfig(metricConfig)) {
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
  };

  return ds;
}
