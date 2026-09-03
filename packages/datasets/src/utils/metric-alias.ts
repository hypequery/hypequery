import type {
  AggregationSpec,
  AnyDatasetInstance,
  DerivedMetricSpec,
  GrainedMetricRef,
  MetricHandle,
  MetricRef,
} from '../types.js';

type AnyMetricSpec = AggregationSpec | DerivedMetricSpec<string>;

function aliasMetricRef(
  metric: MetricRef<string, string, AnyMetricSpec, AnyDatasetInstance>,
  alias: string,
  datasetAlias: string,
): MetricRef<string, string, AnyMetricSpec, AnyDatasetInstance> {
  const aliased: MetricRef<string, string, AnyMetricSpec, AnyDatasetInstance> = {
    ...metric,
    datasetName: datasetAlias,
    name: alias,
    by(grain) {
      return aliasMetricHandle(metric.by(grain), alias, datasetAlias) as GrainedMetricRef<
        string,
        string,
        AnyMetricSpec,
        AnyDatasetInstance
      >;
    },
    contract() {
      return { ...metric.contract(), dataset: datasetAlias, name: alias };
    },
  };
  return aliased;
}

/** Clone a metric handle with the public name used by a published registry. */
export function aliasMetricHandle(
  metric: MetricHandle,
  alias: string,
  datasetAlias: string,
): MetricHandle {
  if (metric.__type === 'metric_ref') {
    return aliasMetricRef(metric, alias, datasetAlias);
  }
  const aliasedMetric = aliasMetricRef(metric.metric, alias, datasetAlias);
  return {
    ...metric,
    metric: aliasedMetric,
    contract() {
      return { ...metric.contract(), dataset: datasetAlias, name: alias };
    },
  };
}
