import type { AnyDatasetInstance } from '../types.js';
import { DatasetPublicationFeature } from './features/dataset-publication.js';
import {
  cloneDatasetPublisherNode,
  createDatasetPublisherNode,
  materializeDatasetPublisherNode,
  type DatasetPublisherNode,
} from './node.js';
import type {
  AddPublishedDataset,
  AnyDatasetPublisherState,
  DatasetPublisherState,
  PublishedAlias,
  PublishedMetricMap,
  PublishDatasetOptions,
} from './types.js';

/** Immutable builder for publishing datasets and named metrics to consumers. */
export class DatasetPublisher<
  TState extends AnyDatasetPublisherState = DatasetPublisherState,
> {
  private readonly publication: DatasetPublicationFeature;

  constructor(
    private readonly state: TState,
    private readonly node: DatasetPublisherNode = createDatasetPublisherNode(),
  ) {
    this.publication = new DatasetPublicationFeature(this);
  }

  getPublicationNode(): DatasetPublisherNode {
    return cloneDatasetPublisherNode(this.node);
  }

  private transition<TNextState extends AnyDatasetPublisherState>(
    state: TNextState,
    node: DatasetPublisherNode,
  ): DatasetPublisher<TNextState> {
    return new DatasetPublisher(state, node);
  }

  publish<
    TDataset extends AnyDatasetInstance,
    const TAlias extends string | undefined = undefined,
    const TMetrics extends PublishedMetricMap<TDataset> = Record<string, never>,
  >(
    dataset: TDataset,
    options: PublishDatasetOptions<TDataset, TAlias, TMetrics> = {},
  ): DatasetPublisher<AddPublishedDataset<
    TState,
    TDataset,
    PublishedAlias<TDataset, TAlias>,
    TMetrics
  >> {
    const alias = options.alias ?? dataset.name;
    const node = this.publication.add(dataset, alias, options.metrics ?? {});
    type NextState = AddPublishedDataset<
      TState,
      TDataset,
      PublishedAlias<TDataset, TAlias>,
      TMetrics
    >;
    const state = { registry: materializeDatasetPublisherNode(node) } as unknown as NextState;
    return this.transition(state, node);
  }

  /** Materialize the plain registry shape accepted by existing Serve/MCP APIs. */
  build(): TState['registry'] {
    return this.state.registry;
  }
}

export function createDatasetPublisher(): DatasetPublisher<DatasetPublisherState> {
  return new DatasetPublisher({ registry: {} });
}
