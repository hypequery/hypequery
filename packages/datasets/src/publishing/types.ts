import type {
  AggregationSpec,
  AnyDatasetInstance,
  DerivedMetricSpec,
  GrainedMetricRef,
  MetricHandle,
  MetricRef,
  TimeGrain,
} from '../types.js';

export type PublishableMetric<TDataset extends AnyDatasetInstance> = MetricHandle<
  TDataset['name'],
  string,
  AggregationSpec | DerivedMetricSpec<TDataset['name']>,
  TDataset
>;

export type PublishedMetricMap<TDataset extends AnyDatasetInstance> = Readonly<
  Record<string, PublishableMetric<TDataset>>
>;

export type PublishedMetricHandle<
  TMetric extends MetricHandle,
  TAlias extends string,
  TDatasetAlias extends string,
> = TMetric extends MetricRef
  ? Omit<TMetric, 'datasetName' | 'name' | 'by'> & {
      readonly datasetName: TDatasetAlias;
      readonly name: TAlias;
      by(grain: TimeGrain): PublishedMetricHandle<ReturnType<TMetric['by']>, TAlias, TDatasetAlias>;
    }
  : TMetric extends GrainedMetricRef
    ? Omit<TMetric, 'metric'> & {
        readonly metric: PublishedMetricHandle<TMetric['metric'], TAlias, TDatasetAlias>;
      }
    : never;

export type PublishedMetrics<
  TMetrics extends Readonly<Record<string, MetricHandle>>,
  TDatasetAlias extends string,
> = {
  readonly [TAlias in keyof TMetrics]: TAlias extends string
    ? PublishedMetricHandle<TMetrics[TAlias], TAlias, TDatasetAlias>
    : never;
};

export type PublishedDataset<
  TDataset extends AnyDatasetInstance = AnyDatasetInstance,
  TAlias extends string = TDataset['name'],
  TMetrics extends PublishedMetricMap<TDataset> = PublishedMetricMap<TDataset>,
> = Omit<TDataset, 'name'> & {
  readonly name: TAlias;
  readonly metrics: PublishedMetrics<TMetrics, TAlias>;
};

export type PublishedDatasetRegistry = Readonly<
  Record<string, PublishedDataset<AnyDatasetInstance, string>>
>;

export interface PublishDatasetOptions<
  TDataset extends AnyDatasetInstance,
  TAlias extends string | undefined = undefined,
  TMetrics extends PublishedMetricMap<TDataset> = Record<string, never>,
> {
  /** Public registry name. Defaults to `dataset.name`. */
  readonly alias?: TAlias;
  /** Public metric names mapped to handles owned by this dataset. */
  readonly metrics?: TMetrics;
}

export interface DatasetPublisherState<
  TRegistry extends PublishedDatasetRegistry = {},
> {
  readonly registry: TRegistry;
}

export type AnyDatasetPublisherState = DatasetPublisherState<PublishedDatasetRegistry>;

export type PublishedAlias<
  TDataset extends AnyDatasetInstance,
  TAlias extends string | undefined,
> = TAlias extends string ? TAlias : TDataset['name'];

export type AddPublishedDataset<
  TState extends AnyDatasetPublisherState,
  TDataset extends AnyDatasetInstance,
  TAlias extends string,
  TMetrics extends PublishedMetricMap<TDataset>,
> = DatasetPublisherState<
  TState['registry'] & Record<TAlias, PublishedDataset<TDataset, TAlias, TMetrics>>
>;
