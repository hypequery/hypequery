import type {
  AggregationSpec,
  MeasureMetricConfig,
  DatasetMeasureMetricSpec,
  BaseMetricRef,
  DatasetInstance,
  DerivedMetricConfig,
  DerivedMetricRef,
  DerivedMetricSpec,
  DimensionDefinition,
  GrainedMetricRef,
  DatasetMeasureDefinition,
  MetricRef,
  RelationshipDefinition,
  SemanticMetadata,
  TimeGrain,
} from '../types.js';
import { buildMetricContract } from './dataset-contract.js';
import { snapshotSemanticMetadata } from './semantic-metadata.js';
import { unsupportedTimeGrainError } from './dataset-time-grains.js';

type AnyDimensions = Record<string, DimensionDefinition>;
type AnyMeasures = Record<string, DatasetMeasureDefinition>;
type AnyRelationships = Record<string, RelationshipDefinition>;

export function isDerivedMetricConfig<
  TMeasures extends Record<string, DatasetMeasureDefinition>,
  TDatasetName extends string,
>(
  config: { measure: string } | MeasureMetricConfig<TMeasures> | DerivedMetricConfig<TDatasetName>,
): config is DerivedMetricConfig<TDatasetName> {
  return 'uses' in config && 'formula' in config;
}

export function createMetricRef<
  TDatasetName extends string,
  TMetricName extends string,
  TSpec extends AggregationSpec | DatasetMeasureMetricSpec | DerivedMetricSpec<TDatasetName>,
  TDataset extends DatasetInstance<AnyDimensions, AnyMeasures, AnyRelationships, TDatasetName>,
>(
  ds: TDataset,
  name: TMetricName,
  spec: TSpec,
  label?: string,
  description?: string,
  metadata: SemanticMetadata = {},
): MetricRef<TDatasetName, TMetricName, TSpec, TDataset> {
  const ref: MetricRef<TDatasetName, TMetricName, TSpec, TDataset> = {
    __type: 'metric_ref',
    datasetName: ds.name,
    name,
    spec,
    label,
    description,
    ...snapshotSemanticMetadata(metadata),
    dataset: ds,

    by(grain: TimeGrain): GrainedMetricRef<TDatasetName, TMetricName, TSpec, TDataset> {
      if (!ds.timeKey) {
        throw new Error(
          `Cannot apply .by("${grain}") to metric "${name}" — dataset "${ds.name}" has no timeKey defined.`,
        );
      }
      const grainError = unsupportedTimeGrainError(ds, grain)
        ?? (spec.__type === 'dataset_measure_metric_spec' && !buildMetricContract(name, ds, spec).grains.includes(grain)
          ? `Measure "${spec.measure}" does not support grain "${grain}"` : undefined);
      if (grainError) {
        throw new Error(`Cannot apply .by("${grain}") to metric "${name}": ${grainError}.`);
      }

      return {
        __type: 'grained_metric_ref',
        metric: ref,
        grain,
        contract() {
          return buildMetricContract(name, ds, spec, label, description, metadata, grain);
        },
      };
    },

    contract() {
      return buildMetricContract(name, ds, spec, label, description, metadata);
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
