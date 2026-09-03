import type { AnyDatasetInstance, MetricHandle } from '../types.js';

export interface DatasetPublicationEntry {
  readonly alias: string;
  readonly dataset: AnyDatasetInstance;
  readonly metrics: Readonly<Record<string, MetricHandle>>;
}

export interface DatasetPublisherNode {
  readonly kind: 'dataset-publisher';
  readonly entries: readonly DatasetPublicationEntry[];
}

export function createDatasetPublisherNode(
  entries: readonly DatasetPublicationEntry[] = [],
): DatasetPublisherNode {
  return {
    kind: 'dataset-publisher',
    entries: entries.map(entry => ({
      alias: entry.alias,
      dataset: entry.dataset,
      metrics: { ...entry.metrics },
    })),
  };
}

export function cloneDatasetPublisherNode(node: DatasetPublisherNode): DatasetPublisherNode {
  return createDatasetPublisherNode(node.entries);
}

export function materializeDatasetPublisherNode(
  node: DatasetPublisherNode,
): Readonly<Record<string, AnyDatasetInstance & {
  readonly metrics: Readonly<Record<string, MetricHandle>>;
}>> {
  const entries = [...node.entries]
    .sort((left, right) => left.alias < right.alias ? -1 : left.alias > right.alias ? 1 : 0)
    .map(entry => [
      entry.alias,
      Object.freeze({
        ...entry.dataset,
        name: entry.alias,
        metrics: Object.freeze({ ...entry.metrics }),
      }),
    ] as const);
  return Object.freeze(Object.fromEntries(entries));
}
