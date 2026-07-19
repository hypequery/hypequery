import type {
  ProtocolDeploymentReleaseEnvelope,
  ProtocolDeploymentReleaseTarget,
} from '@hypequery/protocol';
import type { VerifiedDeploymentBundle } from './bundle.js';
import type { DeploymentIntakeLimits } from './limits.js';

export interface DeploymentSubmissionResponse {
  readonly kind: 'hypequery-deployment-submission';
  readonly version: 1;
  readonly status: 'accepted' | 'already-exists';
  readonly releaseIdentity: string;
  readonly bundleIdentity: string;
}

export interface DeploymentIntakeRequest {
  readonly headers: Readonly<Record<string, string | undefined>>;
  readonly body: AsyncIterable<Uint8Array>;
  readonly signal?: AbortSignal;
}

export interface DeploymentIntakeResponse {
  readonly status: number;
  readonly headers: Readonly<Record<string, string>>;
  readonly body: string;
}

export interface DeploymentAuthenticationInput {
  readonly token: string;
  readonly signal?: AbortSignal;
}

export interface DeploymentAuthenticator<Principal> {
  authenticate(input: DeploymentAuthenticationInput): Promise<Principal | null>;
}

export interface DeploymentAuthorizationInput<Principal> {
  readonly principal: Principal;
  readonly target: ProtocolDeploymentReleaseTarget;
  readonly releaseIdentity: string;
  /** Declared by the canonical release; the bundle bytes are verified after authorization. */
  readonly bundleIdentity: string;
  readonly signal?: AbortSignal;
}

export interface DeploymentAuthorizer<Principal> {
  authorize(input: DeploymentAuthorizationInput<Principal>): Promise<boolean>;
}

/**
 * A completely revalidated submission. The bundle directory is temporary and
 * exists only for the duration of `DeploymentSubmissionStore.accept`.
 */
export interface VerifiedDeploymentSubmission<Principal> {
  readonly principal: Principal;
  readonly release: ProtocolDeploymentReleaseEnvelope;
  readonly releaseCanonical: string;
  readonly releaseIdentity: string;
  readonly bundle: VerifiedDeploymentBundle;
}

export interface DeploymentSubmissionStore<Principal> {
  /** Persist all required bytes before this promise resolves. */
  accept(
    submission: VerifiedDeploymentSubmission<Principal>,
  ): Promise<'accepted' | 'already-exists'>;
}

export interface DeploymentIntakeOptions<Principal> {
  readonly authenticator: DeploymentAuthenticator<Principal>;
  readonly authorizer: DeploymentAuthorizer<Principal>;
  readonly store: DeploymentSubmissionStore<Principal>;
  readonly limits?: Partial<DeploymentIntakeLimits>;
  readonly temporaryDirectory?: string;
}

export interface DeploymentIntake {
  handle(request: DeploymentIntakeRequest): Promise<DeploymentIntakeResponse>;
}
