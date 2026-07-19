import type { ProtocolDeploymentReleaseTarget } from '@hypequery/protocol';
import type {
  DeploymentRuntimeReferenceExecutionInput,
} from './data-plane.js';
import type { DeploymentRuntimeSupervisor } from './runtime-supervisor.js';

export interface DeploymentRuntimeSupervisorExecutorOptions {
  readonly supervisor: DeploymentRuntimeSupervisor;
  readonly target: ProtocolDeploymentReleaseTarget;
  /** The immutable activation generation used to build the matching data plane. */
  readonly activationRevision: string;
  /** Convert provider-neutral execution context into the runtime handler's argument contract. */
  readonly argument: (input: DeploymentRuntimeReferenceExecutionInput) => unknown;
}

export function createDeploymentRuntimeSupervisorExecutor(
  options: DeploymentRuntimeSupervisorExecutorOptions,
): (input: DeploymentRuntimeReferenceExecutionInput) => Promise<unknown> {
  if (!/^[0-9a-f]{64}$/.test(options.activationRevision)) {
    throw new RangeError('activationRevision must be a lowercase SHA-256 identity');
  }
  return async input => await options.supervisor.invoke({
    target: options.target,
    activationRevision: options.activationRevision,
    query: input.query.name,
    argument: options.argument(input),
    signal: input.signal,
  });
}
