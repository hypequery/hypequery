import type { AnyDatasetInstance, MetricHandle } from '../types.js';
import {
  publishedAliasesByName,
  rewirePublishedRelationships,
} from '../utils/published-relationships.js';

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
  const aliasesByName = publishedAliasesByName(node.entries);
  const registry = new Map<string, AnyDatasetInstance>();
  // Relationships resolve their target through this map rather than capturing
  // an instance, so datasets that reference each other are rewired without an
  // ordering constraint.
  const lookup = (alias: string) => registry.get(alias);

  const entries = [...node.entries]
    .sort((left, right) => left.alias < right.alias ? -1 : left.alias > right.alias ? 1 : 0)
    .map(entry => {
      const published = Object.freeze({
        ...entry.dataset,
        name: entry.alias,
        relationships: rewirePublishedRelationships(
          entry.dataset.relationships,
          aliasesByName,
          lookup,
        ),
        metrics: Object.freeze({ ...entry.metrics }),
      });
      registry.set(entry.alias, published);
      return [entry.alias, published] as const;
    });
  return Object.freeze(Object.fromEntries(entries));
}
