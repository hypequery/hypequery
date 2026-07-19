import type { ProtocolDeploymentReleaseTarget } from '@hypequery/protocol';
import type {
  DeploymentRuntimeMaterializer,
  DeploymentRuntimeQueryBinding,
  DeploymentRuntimeSnapshot,
} from './runtime-materialization.js';

const DEFAULT_DRAIN_TIMEOUT_MS = 30_000;
const DEFAULT_RECONCILE_ATTEMPTS = 4;
const MAX_DRAIN_TIMEOUT_MS = 5 * 60_000;
const MAX_RECONCILE_ATTEMPTS = 16;

export type DeploymentRuntimeSupervisorErrorCode =
  | 'HQ_RUNTIME_SUPERVISOR_CONFIGURATION'
  | 'HQ_RUNTIME_SUPERVISOR_CLOSED'
  | 'HQ_RUNTIME_NOT_READY'
  | 'HQ_RUNTIME_QUERY_NOT_FOUND'
  | 'HQ_RUNTIME_QUERY_NOT_EXECUTABLE'
  | 'HQ_RUNTIME_START_FAILED'
  | 'HQ_RUNTIME_HEALTH_FAILED'
  | 'HQ_RUNTIME_INVOCATION_FAILED'
  | 'HQ_RUNTIME_RECONCILE_UNSTABLE'
  | 'HQ_RUNTIME_ABORTED';

export class DeploymentRuntimeSupervisorError extends Error {
  readonly code: DeploymentRuntimeSupervisorErrorCode;

  constructor(
    code: DeploymentRuntimeSupervisorErrorCode,
    message: string,
    options: { readonly cause?: unknown } = {},
  ) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause });
    this.name = 'DeploymentRuntimeSupervisorError';
    this.code = code;
  }
}

export interface DeploymentRuntimeInstanceInvocation {
  readonly query: string;
  readonly binding: DeploymentRuntimeQueryBinding;
  readonly argument: unknown;
  readonly signal?: AbortSignal;
}

export interface DeploymentRuntimeInstance {
  healthCheck(input: { readonly signal?: AbortSignal }): Promise<void>;
  invoke(input: DeploymentRuntimeInstanceInvocation): Promise<unknown>;
  close(): Promise<void>;
}

export interface DeploymentRuntimeFactory {
  start(
    snapshot: DeploymentRuntimeSnapshot,
    input: { readonly signal?: AbortSignal },
  ): Promise<DeploymentRuntimeInstance>;
}

export interface DeploymentRuntimeInvocation {
  readonly target: ProtocolDeploymentReleaseTarget;
  readonly query: string;
  readonly argument: unknown;
  readonly signal?: AbortSignal;
}

export interface DeploymentRuntimeStatus {
  readonly target: ProtocolDeploymentReleaseTarget;
  readonly activationRevision: string;
  readonly releaseIdentity: string;
  readonly bundleIdentity: string;
}

export type DeploymentRuntimeReconcileResult =
  | { readonly status: 'activated'; readonly runtime: DeploymentRuntimeStatus }
  | { readonly status: 'already-current'; readonly runtime: DeploymentRuntimeStatus }
  | { readonly status: 'deactivated'; readonly previous: DeploymentRuntimeStatus }
  | { readonly status: 'no-active-release' };

export interface DeploymentRuntimeSupervisor {
  reconcile(
    target: ProtocolDeploymentReleaseTarget,
    options?: { readonly signal?: AbortSignal },
  ): Promise<DeploymentRuntimeReconcileResult>;
  invoke(input: DeploymentRuntimeInvocation): Promise<unknown>;
  status(target: ProtocolDeploymentReleaseTarget): DeploymentRuntimeStatus | undefined;
  close(): Promise<void>;
}

export interface DeploymentRuntimeSupervisorOptions {
  readonly materializer: DeploymentRuntimeMaterializer;
  readonly factory: DeploymentRuntimeFactory;
  /** In-flight drain deadline from 0 through 300,000 milliseconds. */
  readonly drainTimeoutMs?: number;
  /** Activation-stability attempts from 1 through 16. */
  readonly maxReconcileAttempts?: number;
  readonly onBackgroundError?: (error: unknown) => void;
}

interface Generation {
  readonly snapshot: DeploymentRuntimeSnapshot;
  readonly instance: DeploymentRuntimeInstance;
  inFlight: number;
  draining: boolean;
  drained?: () => void;
}

function supervisorError(
  code: DeploymentRuntimeSupervisorErrorCode,
  message: string,
  cause?: unknown,
): DeploymentRuntimeSupervisorError {
  return new DeploymentRuntimeSupervisorError(code, message, { cause });
}

function boundedInteger(
  input: number | undefined,
  fallback: number,
  maximum: number,
  name: string,
  allowZero = false,
): number {
  const value = input ?? fallback;
  if (!Number.isSafeInteger(value) || value < (allowZero ? 0 : 1) || value > maximum) {
    throw supervisorError(
      'HQ_RUNTIME_SUPERVISOR_CONFIGURATION',
      `${name} must be an integer between ${allowZero ? 0 : 1} and ${maximum}.`,
    );
  }
  return value;
}

function targetKey(target: ProtocolDeploymentReleaseTarget): string {
  return JSON.stringify([target.project, target.environment]);
}

function sameTarget(
  left: ProtocolDeploymentReleaseTarget,
  right: ProtocolDeploymentReleaseTarget,
): boolean {
  return left.project === right.project && left.environment === right.environment;
}

function status(generation: Generation): DeploymentRuntimeStatus {
  const snapshot = generation.snapshot;
  return Object.freeze({
    target: snapshot.target,
    activationRevision: snapshot.activation.revision,
    releaseIdentity: snapshot.releaseIdentity,
    bundleIdentity: snapshot.bundleIdentity,
  });
}

function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) {
    throw supervisorError('HQ_RUNTIME_ABORTED', 'The runtime operation was aborted.', signal.reason);
  }
}

function binding(
  snapshot: DeploymentRuntimeSnapshot,
  queryName: string,
): DeploymentRuntimeQueryBinding {
  const query = snapshot.deployment.queries.find(candidate => candidate.name === queryName);
  if (!query) {
    throw supervisorError('HQ_RUNTIME_QUERY_NOT_FOUND', `Runtime query not found: ${queryName}`);
  }
  if (query.implementation.kind !== 'runtime-reference') {
    throw supervisorError(
      'HQ_RUNTIME_QUERY_NOT_EXECUTABLE',
      `Query is portable and does not use a supervised runtime: ${queryName}`,
    );
  }
  const resolved = snapshot.queries.find(candidate => candidate.query === queryName);
  if (!resolved) {
    throw supervisorError(
      'HQ_RUNTIME_QUERY_NOT_EXECUTABLE',
      `Runtime query binding is unavailable: ${queryName}`,
    );
  }
  return resolved;
}

export function createDeploymentRuntimeSupervisor(
  options: DeploymentRuntimeSupervisorOptions,
): DeploymentRuntimeSupervisor {
  const drainTimeoutMs = boundedInteger(
    options.drainTimeoutMs,
    DEFAULT_DRAIN_TIMEOUT_MS,
    MAX_DRAIN_TIMEOUT_MS,
    'drainTimeoutMs',
    true,
  );
  const maxReconcileAttempts = boundedInteger(
    options.maxReconcileAttempts,
    DEFAULT_RECONCILE_ATTEMPTS,
    MAX_RECONCILE_ATTEMPTS,
    'maxReconcileAttempts',
  );
  const active = new Map<string, Generation>();
  const updates = new Map<string, Promise<unknown>>();
  const background = new Set<Promise<void>>();
  const backgroundFailures: unknown[] = [];
  let closed = false;

  function ensureOpen(): void {
    if (closed) throw supervisorError('HQ_RUNTIME_SUPERVISOR_CLOSED', 'Runtime supervisor is closed.');
  }

  async function drain(generation: Generation): Promise<void> {
    if (generation.draining) return;
    generation.draining = true;
    if (generation.inFlight > 0) {
      await new Promise<void>(resolve => {
        let settled = false;
        const finish = () => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          generation.drained = undefined;
          resolve();
        };
        generation.drained = finish;
        const timer = setTimeout(finish, drainTimeoutMs);
        timer.unref();
      });
    }
    await generation.instance.close();
  }

  function drainInBackground(generation: Generation): void {
    const operation = drain(generation).catch(error => {
      backgroundFailures.push(error);
      options.onBackgroundError?.(error);
    });
    background.add(operation);
    void operation.finally(() => background.delete(operation));
  }

  async function safeClose(instance: DeploymentRuntimeInstance): Promise<void> {
    try {
      await instance.close();
    } catch (error) {
      backgroundFailures.push(error);
      options.onBackgroundError?.(error);
    }
  }

  async function performReconcile(
    target: ProtocolDeploymentReleaseTarget,
    signal: AbortSignal | undefined,
  ): Promise<DeploymentRuntimeReconcileResult> {
    for (let attempt = 0; attempt < maxReconcileAttempts; attempt += 1) {
      ensureOpen();
      throwIfAborted(signal);
      const snapshot = await options.materializer.current(target);
      ensureOpen();
      throwIfAborted(signal);
      const key = targetKey(target);
      const existing = active.get(key);
      if (!snapshot) {
        if (!existing) return Object.freeze({ status: 'no-active-release' });
        active.delete(key);
        drainInBackground(existing);
        return Object.freeze({ status: 'deactivated', previous: status(existing) });
      }
      if (!sameTarget(snapshot.target, target)) {
        throw supervisorError(
          'HQ_RUNTIME_START_FAILED',
          'The materialized runtime snapshot does not match the requested target.',
        );
      }
      if (existing?.snapshot.activation.revision === snapshot.activation.revision) {
        return Object.freeze({ status: 'already-current', runtime: status(existing) });
      }

      let candidate: DeploymentRuntimeInstance;
      try {
        candidate = await options.factory.start(snapshot, { signal });
      } catch (error) {
        if (error instanceof DeploymentRuntimeSupervisorError) throw error;
        throw supervisorError(
          'HQ_RUNTIME_START_FAILED',
          'The candidate deployment runtime could not be started.',
          error,
        );
      }
      try {
        ensureOpen();
        throwIfAborted(signal);
        await candidate.healthCheck({ signal });
      } catch (error) {
        await safeClose(candidate);
        if (error instanceof DeploymentRuntimeSupervisorError) throw error;
        throw supervisorError(
          'HQ_RUNTIME_HEALTH_FAILED',
          'The candidate deployment runtime did not become ready.',
          error,
        );
      }

      let confirmed: DeploymentRuntimeSnapshot | undefined;
      try {
        ensureOpen();
        throwIfAborted(signal);
        confirmed = await options.materializer.current(target);
        ensureOpen();
        throwIfAborted(signal);
      } catch (error) {
        await safeClose(candidate);
        throw error;
      }
      if (confirmed?.activation.revision !== snapshot.activation.revision) {
        await safeClose(candidate);
        continue;
      }

      const generation: Generation = {
        snapshot,
        instance: candidate,
        inFlight: 0,
        draining: false,
      };
      const previous = active.get(key);
      active.set(key, generation);
      if (previous) drainInBackground(previous);
      return Object.freeze({ status: 'activated', runtime: status(generation) });
    }
    throw supervisorError(
      'HQ_RUNTIME_RECONCILE_UNSTABLE',
      'Deployment activation changed repeatedly while starting a runtime.',
    );
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

  return Object.freeze({
    async reconcile(
      target: ProtocolDeploymentReleaseTarget,
      reconcileOptions: { readonly signal?: AbortSignal } = {},
    ): Promise<DeploymentRuntimeReconcileResult> {
      ensureOpen();
      return await serialize(
        targetKey(target),
        () => performReconcile(target, reconcileOptions.signal),
      );
    },

    async invoke(input: DeploymentRuntimeInvocation): Promise<unknown> {
      ensureOpen();
      throwIfAborted(input.signal);
      const generation = active.get(targetKey(input.target));
      if (!generation) {
        throw supervisorError('HQ_RUNTIME_NOT_READY', 'No deployment runtime is ready for target.');
      }
      const resolved = binding(generation.snapshot, input.query);
      generation.inFlight += 1;
      try {
        return await generation.instance.invoke({
          query: input.query,
          binding: resolved,
          argument: input.argument,
          signal: input.signal,
        });
      } catch (error) {
        if (error instanceof DeploymentRuntimeSupervisorError) throw error;
        throw supervisorError(
          'HQ_RUNTIME_INVOCATION_FAILED',
          'The deployment runtime invocation failed.',
          error,
        );
      } finally {
        generation.inFlight -= 1;
        if (generation.draining && generation.inFlight === 0) generation.drained?.();
      }
    },

    status(target: ProtocolDeploymentReleaseTarget): DeploymentRuntimeStatus | undefined {
      const generation = active.get(targetKey(target));
      return generation ? status(generation) : undefined;
    },

    async close(): Promise<void> {
      if (closed) return;
      closed = true;
      await Promise.allSettled([...updates.values()]);
      const generations = [...active.values()];
      active.clear();
      const results = await Promise.allSettled(generations.map(generation => drain(generation)));
      await Promise.allSettled([...background]);
      const failures = [
        ...backgroundFailures,
        ...results
        .filter((result): result is PromiseRejectedResult => result.status === 'rejected')
        .map(result => result.reason),
      ];
      if (failures.length > 0) {
        throw new AggregateError(failures, 'One or more deployment runtimes could not be closed.');
      }
    },
  });
}
