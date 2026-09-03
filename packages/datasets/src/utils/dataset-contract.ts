import type {
  AggregationSpec,
  AnyDatasetInstance,
  DerivedMetricSpec,
  MetricContract,
  SemanticMetadata,
  TimeGrain,
} from '../types.js';
import { snapshotSemanticMetadata } from './semantic-metadata.js';

const ALL_GRAINS: TimeGrain[] = ['day', 'week', 'month', 'quarter', 'year'];

export function buildMetricContract(
  metricName: string,
  ds: AnyDatasetInstance,
  spec: AggregationSpec | DerivedMetricSpec,
  label?: string,
  description?: string,
  metadata: SemanticMetadata = {},
  grain?: TimeGrain,
): MetricContract {
  const dimensionNames = Object.keys(ds.dimensions);
  const measureNames = Object.keys(ds.measures);
  const filterNames = Object.keys(ds.filters).length > 0
    ? Object.keys(ds.filters)
    : dimensionNames.filter(name => ds.dimensions[name]?.filterable !== false);
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
    ...snapshotSemanticMetadata(metadata),
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
