import { selectedTimeMeasures } from './time-query-measures.js';
import { measureSupportedGrains } from './measure-time-grains.js';
import { baseMeasureNames } from './dataset-measures.js';
import type {
  AggregationSpec,
  DatasetMeasureMetricSpec,
  AnyDatasetInstance,
  DerivedMetricSpec,
  MetricContract,
  SemanticMetadata,
  TimeGrain,
} from '../types.js';
import { datasetTimeGrains } from './dataset-time-grains.js';
import { snapshotSemanticMetadata } from './semantic-metadata.js';

export function buildMetricContract(
  metricName: string,
  ds: AnyDatasetInstance,
  spec: AggregationSpec | DatasetMeasureMetricSpec | DerivedMetricSpec,
  label?: string,
  description?: string,
  metadata: SemanticMetadata = {},
  grain?: TimeGrain,
): MetricContract {
  const dimensionNames = Object.keys(ds.dimensions);
  const measureNames = baseMeasureNames(ds.measures);
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
    grains: spec.__type === 'dataset_measure_metric_spec'
      ? measureSupportedGrains(ds.measures, spec.measure, datasetTimeGrains(ds)) : [...datasetTimeGrains(ds)],
    ...(spec.__type === 'dataset_measure_metric_spec' && selectedTimeMeasures(ds, { measures: [spec.measure] }).size
      ? { requiresTimeRange: true as const } : {}),
    grain,
    requires: spec.__type === 'derived_metric_spec'
      ? Object.keys(spec.uses)
      : undefined,
    tenantScoped: !!ds.tenantKey,
  };
}
