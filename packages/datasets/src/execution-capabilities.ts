import matrix from './execution-capabilities.json' with { type: 'json' };

export type DatasetFeature = 'baseMeasures' | 'derivedMeasures' | 'segments'
  | 'windowMeasures' | 'shiftMeasures' | 'approxCountDistinct' | 'subDayGrains';

export interface DatasetFeatureSupport {
  readonly feature: DatasetFeature;
  /** Versions capable of representing the feature, independently of runtime support. */
  readonly protocolVersions: readonly number[];
  readonly typescript: { readonly local: boolean; readonly publish: boolean };
  readonly python: { readonly local: boolean; readonly publish: boolean };
  /** Core's portable runtime rebuilds and executes the feature. */
  readonly portable: boolean;
  /**
   * @deprecated Always equal to `portable`. It never described a hosted
   * service: read what a deployment target accepts from its `accepts`
   * advertisement (RFC 0030).
   */
  readonly cloud: boolean;
}

export interface DatasetExecutionCapabilities {
  readonly version: 1;
  /**
   * @deprecated Not what any Cloud accepts, and no longer in the matrix. A
   * deployment target advertises the contract versions it accepts in its live
   * state (`accepts.deploymentContract`, RFC 0030), and `hypequery deploy`
   * checks it. Kept at its last value until a major release.
   */
  readonly cloudDeploymentVersion: 3;
  readonly features: readonly DatasetFeatureSupport[];
}

/**
 * Conservative feature matrix tested against TS, Python and portable execution.
 * Support assumes a compatible builder and a valid definition/query. This is a
 * discovery aid, not a replacement for contract validation or authorization,
 * and it makes no claim about what a hosted service accepts (RFC 0030).
 */
export const DATASET_EXECUTION_CAPABILITIES: DatasetExecutionCapabilities = Object.freeze({
  version: 1,
  cloudDeploymentVersion: 3,
  features: Object.freeze(matrix.features.map(entry => Object.freeze({
    feature: entry.feature as DatasetFeature,
    protocolVersions: Object.freeze([...entry.protocolVersions]),
    typescript: Object.freeze({ ...entry.typescript }),
    python: Object.freeze({ ...entry.python }),
    portable: entry.portable,
    cloud: entry.portable,
  }))),
});
