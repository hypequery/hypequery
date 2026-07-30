export interface ProtocolDeploymentBundleFile {
  readonly path: string;
  readonly sha256: string;
  readonly byteLength: number;
}

export interface ProtocolDeploymentBundleDeployment extends ProtocolDeploymentBundleFile {
  readonly identity: string;
}

export interface ProtocolDeploymentBundleArtifact extends ProtocolDeploymentBundleFile {
  readonly runtime: 'node' | 'python';
}

export interface ProtocolDeploymentBundleSourceRevision {
  readonly kind: 'git';
  readonly commit: string;
  readonly dirty: boolean;
}

export interface ProtocolDeploymentBundleSource {
  /** Directory within the closed bundle that contains project-relative source files. */
  readonly root: string;
  /** Project-relative API module used to build the deployment. */
  readonly entrypoint: string;
  readonly files: readonly ProtocolDeploymentBundleFile[];
  readonly revision?: ProtocolDeploymentBundleSourceRevision;
}

export interface ProtocolDeploymentBundleManifest {
  readonly kind: 'hypequery-deployment-bundle';
  readonly version: 1;
  readonly deployment: ProtocolDeploymentBundleDeployment;
  readonly artifacts: readonly ProtocolDeploymentBundleArtifact[];
  readonly source?: ProtocolDeploymentBundleSource;
}

export interface ProtocolDeploymentBundleLimits {
  readonly maxArtifacts: number;
  readonly maxSourceFiles: number;
  readonly maxPathBytes: number;
  readonly maxDeploymentBytes: number;
  readonly maxArtifactBytes: number;
  readonly maxSourceFileBytes: number;
  readonly maxSourceBytes: number;
  readonly maxTotalBytes: number;
}

/**
 * Validation budgets for a deployment bundle manifest.
 *
 * Values may tighten the fixed bundle-v1 safety ceilings but cannot raise
 * them. These are parser budgets, not deployment capacity settings.
 */
export interface ProtocolDeploymentBundleOptions {
  readonly limits?: Partial<ProtocolDeploymentBundleLimits>;
}

export type ProtocolDeploymentBundleErrorCode =
  | 'HQ_BUNDLE_TYPE'
  | 'HQ_BUNDLE_UNKNOWN_FIELD'
  | 'HQ_BUNDLE_INVALID_VERSION'
  | 'HQ_BUNDLE_INVALID_VALUE'
  | 'HQ_BUNDLE_INVALID_PATH'
  | 'HQ_BUNDLE_INVALID_REFERENCE'
  | 'HQ_BUNDLE_TOO_MANY_ITEMS'
  | 'HQ_BUNDLE_TOO_LARGE'
  | 'HQ_BUNDLE_UNSAFE_OBJECT';
