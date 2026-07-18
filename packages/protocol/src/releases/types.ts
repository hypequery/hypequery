export interface ProtocolDeploymentReleaseTarget {
  readonly project: string;
  readonly environment: string;
}

export interface ProtocolDeploymentReleaseEnvelope {
  readonly kind: 'hypequery-deployment-release';
  readonly version: 1;
  readonly bundleIdentity: string;
  readonly target: ProtocolDeploymentReleaseTarget;
}

export interface ProtocolDeploymentReleaseLimits {
  readonly maxTargetBytes: number;
}

/** Parser budgets that may tighten, but not raise, release-envelope v1 limits. */
export interface ProtocolDeploymentReleaseOptions {
  readonly limits?: Partial<ProtocolDeploymentReleaseLimits>;
}

export type ProtocolDeploymentReleaseErrorCode =
  | 'HQ_RELEASE_TYPE'
  | 'HQ_RELEASE_UNKNOWN_FIELD'
  | 'HQ_RELEASE_INVALID_VERSION'
  | 'HQ_RELEASE_INVALID_VALUE'
  | 'HQ_RELEASE_TOO_LARGE'
  | 'HQ_RELEASE_UNSAFE_OBJECT';
