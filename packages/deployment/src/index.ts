export {
  createFileSystemDeploymentActivationRegistry,
  DeploymentActivationError,
  validateDeploymentActivationRecord,
} from './activation.js';
export type {
  DeploymentActivationErrorCode,
  DeploymentActivationHistoryPage,
  DeploymentActivationHistoryQuery,
  DeploymentActivationRegistry,
  DeploymentActivationRelease,
  DeploymentActivationRecord,
  DeploymentActivationRequest,
  DeploymentActivationResult,
  DeploymentReleaseReader,
  FileSystemDeploymentActivationRegistryOptions,
} from './activation.js';
export {
  DEPLOYMENT_BUNDLE_CONTRACT,
  DEPLOYMENT_BUNDLE_MANIFEST,
  verifyDeploymentBundle,
} from './bundle.js';
export type { VerifiedDeploymentBundle } from './bundle.js';
export {
  DeploymentIntakeError,
} from './errors.js';
export type { DeploymentIntakeErrorCode } from './errors.js';
export {
  createFileSystemDeploymentSubmissionStore,
  FileSystemDeploymentStoreError,
} from './filesystem-store.js';
export type {
  FileSystemDeploymentStoreErrorCode,
  FileSystemDeploymentSubmissionStore,
  FileSystemDeploymentSubmissionStoreOptions,
  StoredDeploymentSubmission,
} from './filesystem-store.js';
export {
  createDeploymentIntake,
} from './intake.js';
export {
  createDeploymentControlPlaneFetchHandler,
  createDeploymentControlPlaneNodeHandler,
} from './control-plane-adapters.js';
export type {
  DeploymentControlPlaneFetchHandler,
  DeploymentControlPlaneNodeHandler,
} from './control-plane-adapters.js';
export {
  createDeploymentControlPlane,
} from './control-plane.js';
export type {
  DeploymentControlPlane,
  DeploymentControlPlaneAction,
  DeploymentControlPlaneAuthorizationInput,
  DeploymentControlPlaneAuthorizer,
  DeploymentControlPlaneErrorCode,
  DeploymentControlPlaneOptions,
  DeploymentControlPlaneRequest,
  DeploymentControlPlaneResponse,
} from './control-plane.js';
export {
  DEFAULT_DEPLOYMENT_CONTROL_PLANE_LIMITS,
  resolveDeploymentControlPlaneLimits,
} from './control-plane-limits.js';
export type { DeploymentControlPlaneLimits } from './control-plane-limits.js';
export {
  DEFAULT_DEPLOYMENT_INTAKE_LIMITS,
  resolveDeploymentIntakeLimits,
} from './limits.js';
export type { DeploymentIntakeLimits } from './limits.js';
export type {
  DeploymentAuthenticationInput,
  DeploymentAuthenticator,
  DeploymentAuthorizationInput,
  DeploymentAuthorizer,
  DeploymentIntake,
  DeploymentIntakeOptions,
  DeploymentIntakeRequest,
  DeploymentIntakeResponse,
  DeploymentSubmissionResponse,
  DeploymentSubmissionStore,
  VerifiedDeploymentSubmission,
} from './types.js';
export type { DeploymentDataPlanePrincipal } from './principal.js';

// Semantic invocation beside named-query execution (decision 0002).
export {
  createDeploymentSemanticDataPlane,
  DeploymentSemanticInvocationError,
  toProtocolSemanticInvocationFailure,
} from './semantic-data-plane.js';
export type {
  DeploymentSemanticAuthenticationInput,
  DeploymentSemanticBudget,
  DeploymentSemanticDataPlane,
  DeploymentSemanticDataPlaneOptions,
  DeploymentSemanticExecutionInput,
  DeploymentSemanticInvocationRequest,
  DeploymentSemanticTenantInput,
} from './semantic-data-plane.js';
export { validateSemanticOperation } from './semantic-operation-validation.js';
export type {
  SemanticOperationLimits,
  SemanticOperationViolation,
} from './semantic-operation-validation.js';

// What one principal may see of a contract, for a gateway listing targets
// before any call exists (decision 0002, CLOUD-03).
export {
  isDeploymentEndpointAuthorized,
  projectAuthorizedDeploymentContract,
  satisfiesDeploymentAccess,
} from './authorized-contract.js';
