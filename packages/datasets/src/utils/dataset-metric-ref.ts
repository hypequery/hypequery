import type {
  AggregationSpec,
  BaseMetricConfig,
  BaseMetricRef,
  DatasetInstance,
  DerivedMetricConfig,
  DerivedMetricRef,
  DerivedMetricSpec,
  DimensionDefinition,
  GrainedMetricRef,
  MeasureDefinition,
  MetricRef,
  RelationshipDefinition,
  TimeGrain,
} from '../types.js';
import { buildMetricContract } from './dataset-contract.js';

type AnyDimensions = Record<string, DimensionDefinition>;
type AnyMeasures = Record<string, MeasureDefinition>;
type AnyRelationships = Record<string, RelationshipDefinition>;

export function isDerivedMetricConfig<
  TMeasures extends Record<string, MeasureDefinition>,
  TDatasetName extends string,
>(
  config: BaseMetricConfig<TMeasures> | DerivedMetricConfig<TDatasetName>,
): config is DerivedMetricConfig<TDatasetName> {
  return 'uses' in config && 'formula' in config;
}

export function createMetricRef<
  TDatasetName extends string,
  TMetricName extends string,
  TSpec extends AggregationSpec | DerivedMetricSpec<TDatasetName>,
  TDataset extends DatasetInstance<AnyDimensions, AnyMeasures, AnyRelationships, TDatasetName>,
>(
  ds: TDataset,
  name: TMetricName,
  spec: TSpec,
  label?: string,
  description?: string,
): MetricRef<TDatasetName, TMetricName, TSpec, TDataset> {
  const ref: MetricRef<TDatasetName, TMetricName, TSpec, TDataset> = {
    __type: 'metric_ref',
    datasetName: ds.name,
    name,
    spec,
    label,
    description,
    dataset: ds,

    by(grain: TimeGrain): GrainedMetricRef<TDatasetName, TMetricName, TSpec, TDataset> {
      if (!ds.timeKey) {
        throw new Error(
          `Cannot apply .by("${grain}") to metric "${name}" — dataset "${ds.name}" has no timeKey defined.`,
        );
      }

      return {
        __type: 'grained_metric_ref',
        metric: ref,
        grain,
        contract() {
          return buildMetricContract(name, ds, spec, label, description, grain);
        },
      };
    },

    contract() {
      return buildMetricContract(name, ds, spec, label, description);
    },
  };

  return ref;
}

export function createDerivedMetricSpec<TDatasetName extends string>(
  config: DerivedMetricConfig<TDatasetName>,
): DerivedMetricSpec<TDatasetName> {
  return {
    __type: 'derived_metric_spec',
    uses: config.uses,
    formula: config.formula,
  };
}

export type { BaseMetricRef, DerivedMetricRef };
