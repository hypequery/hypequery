import type { AnyDatasetInstance, GrainedMetricRef, MetricRef } from '../types.js';
import { getMetricRef } from './metric-handle.js';

/**
 * *dataset* as a stream sees it: `limits.maxStreamRows`, when set, is its
 * result ceiling. Every validator and planner reads the ceiling from
 * `limits.maxResultSize`, so a view keeps one code path for pages and streams.
 */
export function datasetForStream<TDataset extends AnyDatasetInstance>(dataset: TDataset): TDataset {
  const ceiling = dataset.limits?.maxStreamRows;
  if (ceiling === undefined) return dataset;
  return { ...dataset, limits: { ...dataset.limits, maxResultSize: ceiling } };
}

/** *metric* over its dataset's stream view; see {@link datasetForStream}. */
export function metricForStream<TMetric extends MetricRef | GrainedMetricRef>(metric: TMetric): TMetric {
  const ref = getMetricRef(metric);
  const dataset = datasetForStream(ref.dataset as AnyDatasetInstance);
  if (dataset === ref.dataset) return metric;
  const viewed = { ...ref, dataset } as MetricRef;
  return (metric.__type === 'grained_metric_ref' ? { ...metric, metric: viewed } : viewed) as TMetric;
}
