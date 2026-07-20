import type { ProtocolDeploymentReleaseTarget } from '@hypequery/protocol';
import {
  createFileSystemDeploymentActivationRegistry,
  type DeploymentActivationRegistry,
} from './activation.js';
import {
  createDeploymentControlPlane,
  type DeploymentControlPlane,
  type DeploymentControlPlaneAuthorizer,
} from './control-plane.js';
import type { DeploymentControlPlaneLimits } from './control-plane-limits.js';
import {
  createFileSystemDeploymentSubmissionStore,
  type FileSystemDeploymentSubmissionStore,
} from './filesystem-store.js';
import {
  createDeploymentHost,
  type DeploymentHost,
  type DeploymentHostDataPlaneConfiguration,
  type DeploymentHostDataPlaneInput,
} from './host.js';
import { createDeploymentIntake } from './intake.js';
import type { DeploymentIntakeLimits } from './limits.js';
import {
  createNodeWorkerDeploymentRuntimeFactory,
  type NodeDeploymentRuntimeFactoryOptions,
} from './node-runtime-factory.js';
import {
  createDeploymentRuntimeMaterializer,
  type DeploymentRuntimeMaterializer,
} from './runtime-materialization.js';
import {
  createDeploymentRuntimeSupervisor,
  type DeploymentRuntimeFactory,
  type DeploymentRuntimeSupervisor,
} from './runtime-supervisor.js';
import type {
  DeploymentAuthenticator,
  DeploymentAuthorizer,
  DeploymentIntake,
} from './types.js';

export interface FileSystemDeploymentHostOptions<SubmissionPrincipal, ControlPrincipal> {
  readonly directory: string;
  readonly targets: readonly ProtocolDeploymentReleaseTarget[];
  readonly intake: {
    readonly authenticator: DeploymentAuthenticator<SubmissionPrincipal>;
    readonly authorizer: DeploymentAuthorizer<SubmissionPrincipal>;
    readonly limits?: Partial<DeploymentIntakeLimits>;
    readonly temporaryDirectory?: string;
  };
  readonly controlPlane: {
    readonly authenticator: DeploymentAuthenticator<ControlPrincipal>;
    readonly authorizer: DeploymentControlPlaneAuthorizer<ControlPrincipal>;
    readonly limits?: Partial<DeploymentControlPlaneLimits>;
  };
  readonly configureDataPlane: (
    input: DeploymentHostDataPlaneInput,
  ) => DeploymentHostDataPlaneConfiguration | Promise<DeploymentHostDataPlaneConfiguration>;
  /** Defaults to the reference Node worker runtime factory. */
  readonly runtimeFactory?: DeploymentRuntimeFactory;
  readonly nodeRuntime?: NodeDeploymentRuntimeFactoryOptions;
  readonly activationClock?: () => Date;
  readonly maxMaterializationAttempts?: number;
  readonly drainTimeoutMs?: number;
  readonly maxReconcileAttempts?: number;
  readonly maxHostStabilityAttempts?: number;
  readonly onBackgroundError?: (error: unknown) => void;
}

export interface FileSystemDeploymentHost<SubmissionPrincipal> {
  readonly store: FileSystemDeploymentSubmissionStore<SubmissionPrincipal>;
  readonly activations: DeploymentActivationRegistry;
  readonly intake: DeploymentIntake;
  readonly controlPlane: DeploymentControlPlane;
  readonly materializer: DeploymentRuntimeMaterializer;
  readonly supervisor: DeploymentRuntimeSupervisor;
  readonly host: DeploymentHost;
  start(options?: { readonly signal?: AbortSignal }): Promise<void>;
  close(): Promise<void>;
}

export function createFileSystemDeploymentHost<SubmissionPrincipal, ControlPrincipal>(
  options: FileSystemDeploymentHostOptions<SubmissionPrincipal, ControlPrincipal>,
): FileSystemDeploymentHost<SubmissionPrincipal> {
  if (options.runtimeFactory !== undefined && options.nodeRuntime !== undefined) {
    throw new TypeError('runtimeFactory and nodeRuntime cannot both be configured.');
  }
  const targets = Object.freeze([...options.targets]);
  const store = createFileSystemDeploymentSubmissionStore<SubmissionPrincipal>({
    directory: options.directory,
  });
  const activations = createFileSystemDeploymentActivationRegistry({
    directory: options.directory,
    releases: store,
    clock: options.activationClock,
  });
  const intake = createDeploymentIntake({
    ...options.intake,
    store,
  });
  const materializer = createDeploymentRuntimeMaterializer({
    activations,
    releases: store,
    maxStabilityAttempts: options.maxMaterializationAttempts,
  });
  const runtimeFactory = options.runtimeFactory
    ?? createNodeWorkerDeploymentRuntimeFactory(options.nodeRuntime);
  const supervisor = createDeploymentRuntimeSupervisor({
    materializer,
    factory: runtimeFactory,
    drainTimeoutMs: options.drainTimeoutMs,
    maxReconcileAttempts: options.maxReconcileAttempts,
    onBackgroundError: options.onBackgroundError,
  });
  const host = createDeploymentHost({
    supervisor,
    configureDataPlane: options.configureDataPlane,
    maxStabilityAttempts: options.maxHostStabilityAttempts,
    onBackgroundError: options.onBackgroundError,
  });
  const controlPlane = createDeploymentControlPlane({
    intake,
    activations,
    ...options.controlPlane,
    onActivation: activation => host.scheduleReconcile(activation.target),
    onBackgroundError: options.onBackgroundError,
  });
  let startPromise: Promise<void> | undefined;

  const result: FileSystemDeploymentHost<SubmissionPrincipal> = {
    store,
    activations,
    intake,
    controlPlane,
    materializer,
    supervisor,
    host,
    start(startOptions = {}): Promise<void> {
      const pending = startPromise ??= host.start(targets, startOptions).then(() => undefined);
      void pending.catch(() => {
        if (startPromise === pending) startPromise = undefined;
      });
      return pending;
    },
    close: () => host.close(),
  };
  return Object.freeze(result);
}
