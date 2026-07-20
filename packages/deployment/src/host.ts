import {
  validateProtocolDeploymentReleaseTarget,
  type ProtocolDeploymentContract,
  type ProtocolDeploymentReleaseTarget,
} from '@hypequery/protocol';
import {
  createDeploymentDataPlane,
  type DeploymentDataPlane,
  type DeploymentDataPlaneJsonRequest,
  type DeploymentDataPlaneOptions,
  type DeploymentDataPlaneRequest,
  type DeploymentDataPlaneResult,
  type DeploymentRuntimeReferenceExecutionInput,
} from './data-plane.js';
import { createDeploymentRuntimeSupervisorExecutor } from './data-plane-runtime.js';
import type {
  DeploymentRuntimeGeneration,
  DeploymentRuntimeReconcileResult,
  DeploymentRuntimeStatus,
  DeploymentRuntimeSupervisor,
} from './runtime-supervisor.js';

const DEFAULT_STABILITY_ATTEMPTS = 4;
const MAX_STABILITY_ATTEMPTS = 16;

export type DeploymentHostErrorCode =
  | 'HQ_DEPLOYMENT_HOST_CONFIGURATION'
  | 'HQ_DEPLOYMENT_HOST_CLOSED'
  | 'HQ_DEPLOYMENT_HOST_NOT_READY'
  | 'HQ_DEPLOYMENT_HOST_RECONCILE_FAILED'
  | 'HQ_DEPLOYMENT_HOST_RECONCILE_UNSTABLE';

export class DeploymentHostError extends Error {
  readonly code: DeploymentHostErrorCode;

  constructor(
    code: DeploymentHostErrorCode,
    message: string,
    options: { readonly cause?: unknown } = {},
  ) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause });
    this.name = 'DeploymentHostError';
    this.code = code;
  }
}

export interface DeploymentHostDataPlaneInput {
  readonly target: ProtocolDeploymentReleaseTarget;
  readonly status: DeploymentRuntimeStatus;
  readonly deployment: ProtocolDeploymentContract;
}

export type DeploymentHostDataPlaneConfiguration = Omit<
  DeploymentDataPlaneOptions,
  'deployment' | 'executeRuntimeReference'
> & {
  readonly runtimeArgument: (input: DeploymentRuntimeReferenceExecutionInput) => unknown;
};

export interface DeploymentHostOptions {
  readonly supervisor: DeploymentRuntimeSupervisor;
  readonly configureDataPlane: (
    input: DeploymentHostDataPlaneInput,
  ) => DeploymentHostDataPlaneConfiguration | Promise<DeploymentHostDataPlaneConfiguration>;
  /** Generation-stability attempts from 1 through 16. */
  readonly maxStabilityAttempts?: number;
  readonly onBackgroundError?: (error: unknown) => void;
}

export interface DeploymentHost {
  start(
    targets: readonly ProtocolDeploymentReleaseTarget[],
    options?: { readonly signal?: AbortSignal },
  ): Promise<readonly DeploymentRuntimeReconcileResult[]>;
  reconcile(
    target: ProtocolDeploymentReleaseTarget,
    options?: { readonly signal?: AbortSignal },
  ): Promise<DeploymentRuntimeReconcileResult>;
  scheduleReconcile(target: ProtocolDeploymentReleaseTarget): void;
  execute(
    target: ProtocolDeploymentReleaseTarget,
    request: DeploymentDataPlaneRequest,
  ): Promise<DeploymentDataPlaneResult>;
  dataPlane(target: ProtocolDeploymentReleaseTarget): DeploymentDataPlane;
  status(target: ProtocolDeploymentReleaseTarget): DeploymentRuntimeStatus | undefined;
  close(): Promise<void>;
}

interface HostedGeneration {
  readonly generation: DeploymentRuntimeGeneration;
  readonly dataPlane: DeploymentDataPlane;
}

function hostError(
  code: DeploymentHostErrorCode,
  message: string,
  cause?: unknown,
): DeploymentHostError {
  return new DeploymentHostError(code, message, { cause });
}

function targetKey(target: ProtocolDeploymentReleaseTarget): string {
  return JSON.stringify([target.project, target.environment]);
}

function target(input: ProtocolDeploymentReleaseTarget): ProtocolDeploymentReleaseTarget {
  try {
    return validateProtocolDeploymentReleaseTarget(input);
  } catch (error) {
    throw hostError(
      'HQ_DEPLOYMENT_HOST_CONFIGURATION',
      'The deployment host target is invalid.',
      error,
    );
  }
}

function stabilityAttempts(input: number | undefined): number {
  const value = input ?? DEFAULT_STABILITY_ATTEMPTS;
  if (!Number.isSafeInteger(value) || value < 1 || value > MAX_STABILITY_ATTEMPTS) {
    throw hostError(
      'HQ_DEPLOYMENT_HOST_CONFIGURATION',
      `maxStabilityAttempts must be between 1 and ${MAX_STABILITY_ATTEMPTS}.`,
    );
  }
  return value;
}

function sameGeneration(
  left: DeploymentRuntimeGeneration | undefined,
  right: DeploymentRuntimeGeneration | undefined,
): boolean {
  return left?.status.activationRevision === right?.status.activationRevision;
}

export function createDeploymentHost(options: DeploymentHostOptions): DeploymentHost {
  if (!options.supervisor || typeof options.configureDataPlane !== 'function') {
    throw hostError(
      'HQ_DEPLOYMENT_HOST_CONFIGURATION',
      'A runtime supervisor and data-plane configurator are required.',
    );
  }
  const maximumAttempts = stabilityAttempts(options.maxStabilityAttempts);
  const active = new Map<string, HostedGeneration>();
  const updates = new Map<string, Promise<unknown>>();
  const background = new Set<Promise<void>>();
  let closed = false;
  let closePromise: Promise<void> | undefined;

  function ensureOpen(): void {
    if (closed) throw hostError('HQ_DEPLOYMENT_HOST_CLOSED', 'The deployment host is closed.');
  }

  function serialize<T>(key: string, operation: () => Promise<T>): Promise<T> {
    const previous = updates.get(key) ?? Promise.resolve();
    const current = previous.catch(() => undefined).then(operation);
    const tracked = current.finally(() => {
      if (updates.get(key) === tracked) updates.delete(key);
    });
    updates.set(key, tracked);
    return tracked;
  }

  async function install(
    desiredTarget: ProtocolDeploymentReleaseTarget,
    signal: AbortSignal | undefined,
  ): Promise<DeploymentRuntimeReconcileResult> {
    for (let attempt = 0; attempt < maximumAttempts; attempt += 1) {
      ensureOpen();
      const result = await options.supervisor.reconcile(desiredTarget, { signal });
      ensureOpen();
      if (result.status === 'deactivated' || result.status === 'no-active-release') {
        active.delete(targetKey(desiredTarget));
        return result;
      }
      const generation = options.supervisor.generation(desiredTarget);
      if (!generation
        || generation.status.activationRevision !== result.runtime.activationRevision) {
        continue;
      }
      let configuration: DeploymentHostDataPlaneConfiguration;
      try {
        configuration = await options.configureDataPlane(Object.freeze({
          target: desiredTarget,
          status: generation.status,
          deployment: generation.deployment,
        }));
      } catch (error) {
        throw hostError(
          'HQ_DEPLOYMENT_HOST_RECONCILE_FAILED',
          'The active deployment data plane could not be configured.',
          error,
        );
      }
      ensureOpen();
      let dataPlane: DeploymentDataPlane;
      try {
        dataPlane = createDeploymentDataPlane({
          ...configuration,
          deployment: generation.deployment,
          executeRuntimeReference: createDeploymentRuntimeSupervisorExecutor({
            supervisor: options.supervisor,
            target: desiredTarget,
            activationRevision: generation.status.activationRevision,
            argument: configuration.runtimeArgument,
          }),
        });
      } catch (error) {
        throw hostError(
          'HQ_DEPLOYMENT_HOST_RECONCILE_FAILED',
          'The active deployment data plane could not be constructed.',
          error,
        );
      }
      const confirmed = options.supervisor.generation(desiredTarget);
      if (!sameGeneration(generation, confirmed)) continue;
      active.set(targetKey(desiredTarget), Object.freeze({ generation, dataPlane }));
      return result;
    }
    throw hostError(
      'HQ_DEPLOYMENT_HOST_RECONCILE_UNSTABLE',
      'The active deployment generation changed repeatedly during host reconciliation.',
    );
  }

  const host: DeploymentHost = {
    async start(targets, startOptions = {}) {
      ensureOpen();
      const validated = targets.map(target);
      const keys = validated.map(targetKey);
      if (new Set(keys).size !== keys.length) {
        throw hostError(
          'HQ_DEPLOYMENT_HOST_CONFIGURATION',
          'Deployment host startup targets must be unique.',
        );
      }
      return Object.freeze(await Promise.all(validated.map(candidate => (
        host.reconcile(candidate, startOptions)
      ))));
    },

    reconcile(input, reconcileOptions = {}) {
      ensureOpen();
      const desiredTarget = target(input);
      return serialize(
        targetKey(desiredTarget),
        () => install(desiredTarget, reconcileOptions.signal),
      );
    },

    scheduleReconcile(input): void {
      ensureOpen();
      const operation = host.reconcile(input).then(() => undefined).catch(error => {
        try {
          options.onBackgroundError?.(error);
        } catch {
          // A diagnostic callback cannot make reconciliation an unhandled rejection.
        }
      });
      background.add(operation);
      void operation.finally(() => background.delete(operation)).catch(() => undefined);
    },

    async execute(input, request): Promise<DeploymentDataPlaneResult> {
      ensureOpen();
      const desiredTarget = target(input);
      const hosted = active.get(targetKey(desiredTarget));
      if (!hosted) {
        throw hostError(
          'HQ_DEPLOYMENT_HOST_NOT_READY',
          'No deployment data plane is ready for target.',
        );
      }
      return await hosted.dataPlane.execute(request);
    },

    dataPlane(input): DeploymentDataPlane {
      ensureOpen();
      const desiredTarget = target(input);
      return Object.freeze({
        execute: (request: DeploymentDataPlaneRequest) => host.execute(desiredTarget, request),
        executeJson: (request: DeploymentDataPlaneJsonRequest) => {
          ensureOpen();
          const hosted = active.get(targetKey(desiredTarget));
          if (!hosted) {
            throw hostError(
              'HQ_DEPLOYMENT_HOST_NOT_READY',
              'No deployment data plane is ready for target.',
            );
          }
          return hosted.dataPlane.executeJson(request);
        },
      });
    },

    status(input): DeploymentRuntimeStatus | undefined {
      ensureOpen();
      const desiredTarget = target(input);
      return active.get(targetKey(desiredTarget))?.generation.status;
    },

    close(): Promise<void> {
      if (closePromise) return closePromise;
      closed = true;
      closePromise = (async () => {
        await Promise.allSettled([...updates.values()]);
        await Promise.allSettled([...background]);
        active.clear();
        await options.supervisor.close();
      })();
      return closePromise;
    },
  };
  return Object.freeze(host);
}
