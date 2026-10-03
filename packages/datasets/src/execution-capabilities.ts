import matrix from './execution-capabilities.json' with { type: 'json' };

export type DatasetFeature = 'baseMeasures' | 'derivedMeasures' | 'segments'
  | 'windowMeasures' | 'shiftMeasures' | 'approxCountDistinct' | 'subDayGrains';

export interface DatasetFeatureSupport {
  readonly feature: DatasetFeature;
  /** Versions capable of representing the feature, independently of runtime support. */
  readonly protocolVersions: readonly number[];
  readonly typescript: { readonly local: boolean; readonly publish: boolean };
  readonly python: { readonly local: boolean; readonly publish: boolean };
  /** Repository portable runtime support, not qualification of a hosted service. */
  readonly cloud: boolean;
}

export interface DatasetExecutionCapabilities {
  readonly version: 1;
  readonly cloudDeploymentVersion: 2;
  readonly features: readonly DatasetFeatureSupport[];
}

/**
 * Conservative feature matrix tested against TS, Python and portable execution.
 * Support assumes a compatible builder and a valid definition/query. This is a
 * discovery aid, not a replacement for contract validation or authorization.
 */
export const DATASET_EXECUTION_CAPABILITIES: DatasetExecutionCapabilities = Object.freeze({
  version: 1,
  cloudDeploymentVersion: 2,
  features: Object.freeze(matrix.features.map(entry => Object.freeze({
    feature: entry.feature as DatasetFeature,
    protocolVersions: Object.freeze([...entry.protocolVersions]),
    typescript: Object.freeze({ ...entry.typescript }),
    python: Object.freeze({ ...entry.python }),
    cloud: entry.cloud,
  }))),
});
