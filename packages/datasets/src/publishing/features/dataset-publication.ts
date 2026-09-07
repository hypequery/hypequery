import type { AnyDatasetInstance, MetricHandle } from '../../types.js';
import { aliasMetricHandle } from '../../utils/metric-alias.js';
import { assertPublishedName } from '../../utils/published-name.js';
import type { DatasetPublisherNode } from '../node.js';

export class DatasetPublicationFeature {
  constructor(private readonly publisher: {
    getPublicationNode(): DatasetPublisherNode;
  }) {}

  add(
    dataset: AnyDatasetInstance,
    alias: string,
    metrics: Readonly<Record<string, MetricHandle>>,
  ): DatasetPublisherNode {
    const node = this.publisher.getPublicationNode();
    assertPublishedName(alias, 'dataset');
    if (node.entries.some(entry => entry.alias === alias)) {
      throw new Error(`Dataset alias "${alias}" is already published.`);
    }
    if (node.entries.some(entry => entry.dataset.name === dataset.name)) {
      throw new Error(`Dataset "${dataset.name}" is already published.`);
    }

    const publishedMetrics: Record<string, MetricHandle> = {};
    for (const [metricAlias, metric] of Object.entries(metrics)) {
      assertPublishedName(metricAlias, 'metric');
      const ref = metric.__type === 'grained_metric_ref' ? metric.metric : metric;
      if (ref.datasetName !== dataset.name) {
        throw new Error(
          `Metric "${metricAlias}" belongs to dataset "${ref.datasetName}", expected "${dataset.name}".`,
        );
      }
      publishedMetrics[metricAlias] = aliasMetricHandle(metric, metricAlias, alias);
    }

    return {
      kind: 'dataset-publisher',
      entries: [
        ...node.entries,
        { alias, dataset, metrics: publishedMetrics },
      ],
    };
  }
}
