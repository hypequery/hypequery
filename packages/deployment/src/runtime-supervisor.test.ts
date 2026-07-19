import { prepareProtocolDeploymentContract } from '@hypequery/protocol';
import { describe, expect, it, vi } from 'vitest';
import type {
  DeploymentRuntimeMaterializer,
  DeploymentRuntimeSnapshot,
} from './runtime-materialization.js';
import {
  createDeploymentRuntimeSupervisor,
  DeploymentRuntimeSupervisorError,
  type DeploymentRuntimeFactory,
  type DeploymentRuntimeInstance,
} from './runtime-supervisor.js';

const TARGET = Object.freeze({ project: 'analytics', environment: 'production' });

function snapshot(revisionCharacter: string, portable = false): DeploymentRuntimeSnapshot {
  const revision = revisionCharacter.repeat(64);
  const releaseIdentity = revisionCharacter.toUpperCase().repeat(64).toLowerCase();
  const artifactSha256 = 'a'.repeat(64);
  const implementation = portable
    ? {
        kind: 'semantic-plan' as const,
        query: {
          kind: 'dataset' as const,
          dataset: 'orders',
          dimensions: [],
          measures: [],
          filters: [],
          orderBy: [],
        },
      }
    : {
        kind: 'runtime-reference' as const,
        runtime: 'node' as const,
        artifactSha256,
        entrypoint: 'queries.handler',
      };
  const deployment = prepareProtocolDeploymentContract({
    kind: 'hypequery-deployment' as const,
    version: 1 as const,
    datasets: portable ? [{
      name: 'orders',
      source: 'orders',
      tenant: { kind: 'not-required' as const },
      dimensions: [],
      measures: [],
      filters: [],
      metrics: [],
      relationships: [],
    }] : [],
    queries: [{
      name: 'handler',
      input: { kind: 'any' as const },
      output: { kind: 'any' as const },
      implementation,
      endpoint: {
        access: { kind: 'public' as const },
        tenant: { kind: 'not-required' as const },
        method: 'POST' as const,
        path: '/handler',
      },
      tags: [],
    }],
    artifacts: portable ? [] : [{ runtime: 'node' as const, artifactSha256 }],
  }).contract;
  return Object.freeze({
    target: TARGET,
    activation: Object.freeze({
      kind: 'hypequery-deployment-activation',
      version: 1,
      revision,
      target: TARGET,
      releaseIdentity,
      previousRevision: null,
      previousReleaseIdentity: null,
      activatedAt: '2026-07-19T12:00:00.000Z',
    }),
    release: Object.freeze({
      kind: 'hypequery-deployment-release',
      version: 1,
      bundleIdentity: 'b'.repeat(64),
      target: TARGET,
    }),
    releaseIdentity,
    bundleIdentity: 'b'.repeat(64),
    deployment,
    artifacts: portable ? [] : [Object.freeze({
      runtime: 'node',
      artifactSha256,
      byteLength: 1,
      entrypoints: Object.freeze(['queries.handler']),
      read: () => Uint8Array.of(1),
    })],
    queries: portable ? [] : [Object.freeze({
      query: 'handler',
      runtime: 'node',
      artifactSha256,
      entrypoint: 'queries.handler',
    })],
  });
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((accept, decline) => {
    resolve = accept;
    reject = decline;
  });
  return { promise, resolve, reject };
}

function runtimeInstance(label: string) {
  const healthCheck = vi.fn(async () => undefined);
  const invoke = vi.fn<DeploymentRuntimeInstance['invoke']>(
    async ({ argument }) => ({ label, argument }),
  );
  const close = vi.fn<DeploymentRuntimeInstance['close']>(async () => undefined);
  return { instance: { healthCheck, invoke, close }, healthCheck, invoke, close };
}

function materializer(current: () => Promise<DeploymentRuntimeSnapshot | undefined>) {
  return { current: vi.fn(current) } satisfies DeploymentRuntimeMaterializer;
}

describe('deployment runtime supervisor', () => {
  it('starts, checks, atomically activates, and routes by named query', async () => {
    const active = snapshot('1');
    const runtime = runtimeInstance('v1');
    const source = materializer(async () => active);
    const start = vi.fn(async () => runtime.instance);
    const supervisor = createDeploymentRuntimeSupervisor({
      materializer: source,
      factory: { start },
    });

    const result = await supervisor.reconcile(TARGET);
    const response = await supervisor.invoke({ target: TARGET, query: 'handler', argument: 42 });

    expect(result).toMatchObject({
      status: 'activated',
      runtime: { activationRevision: active.activation.revision },
    });
    expect(start).toHaveBeenCalledWith(active, { signal: undefined });
    expect(runtime.healthCheck).toHaveBeenCalledOnce();
    expect(runtime.invoke).toHaveBeenCalledWith({
      query: 'handler',
      binding: active.queries[0],
      argument: 42,
      signal: undefined,
    });
    expect(response).toEqual({ label: 'v1', argument: 42 });
    expect(supervisor.status(TARGET)?.releaseIdentity).toBe(active.releaseIdentity);
    await supervisor.close();
  });

  it('rejects an invocation pinned to a different activation generation', async () => {
    const active = snapshot('e');
    const runtime = runtimeInstance('v1');
    const supervisor = createDeploymentRuntimeSupervisor({
      materializer: materializer(async () => active),
      factory: { start: async () => runtime.instance },
    });
    await supervisor.reconcile(TARGET);

    await expect(supervisor.invoke({
      target: TARGET,
      activationRevision: 'f'.repeat(64),
      query: 'handler',
      argument: null,
    })).rejects.toMatchObject({ code: 'HQ_RUNTIME_NOT_READY' });
    expect(runtime.invoke).not.toHaveBeenCalled();
    await supervisor.close();
  });

  it('keeps the old runtime active until its in-flight work drains after cutover', async () => {
    const first = snapshot('2');
    const second = snapshot('3');
    let desired = first;
    const source = materializer(async () => desired);
    const firstRuntime = runtimeInstance('v1');
    const secondRuntime = runtimeInstance('v2');
    const pending = deferred<unknown>();
    firstRuntime.invoke.mockImplementationOnce(async () => pending.promise);
    const start = vi.fn(async (candidate: DeploymentRuntimeSnapshot) => (
      candidate === first ? firstRuntime.instance : secondRuntime.instance
    ));
    const supervisor = createDeploymentRuntimeSupervisor({
      materializer: source,
      factory: { start },
    });
    await supervisor.reconcile(TARGET);
    const oldInvocation = supervisor.invoke({ target: TARGET, query: 'handler', argument: 'old' });
    await vi.waitFor(() => expect(firstRuntime.invoke).toHaveBeenCalledOnce());

    desired = second;
    await expect(supervisor.reconcile(TARGET)).resolves.toMatchObject({ status: 'activated' });
    expect(firstRuntime.close).not.toHaveBeenCalled();
    await expect(supervisor.invoke({ target: TARGET, query: 'handler', argument: 'new' }))
      .resolves.toEqual({ label: 'v2', argument: 'new' });

    pending.resolve('old-result');
    await expect(oldInvocation).resolves.toBe('old-result');
    await vi.waitFor(() => expect(firstRuntime.close).toHaveBeenCalledOnce());
    await supervisor.close();
  });

  it('keeps serving the old generation when candidate readiness fails', async () => {
    const first = snapshot('4');
    const second = snapshot('5');
    let desired = first;
    const source = materializer(async () => desired);
    const firstRuntime = runtimeInstance('v1');
    const failedRuntime = runtimeInstance('v2');
    failedRuntime.healthCheck.mockRejectedValueOnce(new Error('not ready'));
    const factory: DeploymentRuntimeFactory = {
      start: async candidate => candidate === first ? firstRuntime.instance : failedRuntime.instance,
    };
    const supervisor = createDeploymentRuntimeSupervisor({ materializer: source, factory });
    await supervisor.reconcile(TARGET);
    desired = second;

    await expect(supervisor.reconcile(TARGET)).rejects.toMatchObject({
      code: 'HQ_RUNTIME_HEALTH_FAILED',
    });
    expect(supervisor.status(TARGET)?.activationRevision).toBe(first.activation.revision);
    await expect(supervisor.invoke({ target: TARGET, query: 'handler', argument: null }))
      .resolves.toEqual({ label: 'v1', argument: null });
    expect(failedRuntime.close).toHaveBeenCalledOnce();
    await supervisor.close();
  });

  it('preserves cancellation when startup is aborted in flight', async () => {
    const active = snapshot('d');
    const controller = new AbortController();
    const start = vi.fn<DeploymentRuntimeFactory['start']>(async (_candidate, { signal }) => (
      await new Promise<DeploymentRuntimeInstance>((_resolve, reject) => {
        signal?.addEventListener('abort', () => reject(new Error('startup aborted')), {
          once: true,
        });
      })
    ));
    const supervisor = createDeploymentRuntimeSupervisor({
      materializer: materializer(async () => active),
      factory: { start },
    });

    const reconcile = supervisor.reconcile(TARGET, { signal: controller.signal });
    await vi.waitFor(() => expect(start).toHaveBeenCalledOnce());
    controller.abort('cancelled');

    await expect(reconcile).rejects.toMatchObject({ code: 'HQ_RUNTIME_ABORTED' });
    await supervisor.close();
  });

  it('discards a superseded candidate and retries the newly confirmed activation', async () => {
    const stale = snapshot('6');
    const current = snapshot('7');
    const values = [stale, current, current, current];
    const source = materializer(async () => values.shift() ?? current);
    const staleRuntime = runtimeInstance('stale');
    const currentRuntime = runtimeInstance('current');
    const start = vi.fn(async candidate => (
      candidate === stale ? staleRuntime.instance : currentRuntime.instance
    ));
    const supervisor = createDeploymentRuntimeSupervisor({
      materializer: source,
      factory: { start },
      maxReconcileAttempts: 2,
    });

    await expect(supervisor.reconcile(TARGET)).resolves.toMatchObject({ status: 'activated' });

    expect(staleRuntime.close).toHaveBeenCalledOnce();
    expect(supervisor.status(TARGET)?.activationRevision).toBe(current.activation.revision);
    expect(start).toHaveBeenCalledTimes(2);
    await supervisor.close();
  });

  it('serializes concurrent reconciliation and deactivates absent targets', async () => {
    const active = snapshot('8');
    let desired: DeploymentRuntimeSnapshot | undefined = active;
    const source = materializer(async () => desired);
    const runtime = runtimeInstance('v1');
    const start = vi.fn(async () => runtime.instance);
    const supervisor = createDeploymentRuntimeSupervisor({
      materializer: source,
      factory: { start },
    });

    const [first, second] = await Promise.all([
      supervisor.reconcile(TARGET),
      supervisor.reconcile(TARGET),
    ]);
    expect([first.status, second.status]).toEqual(['activated', 'already-current']);
    expect(start).toHaveBeenCalledOnce();

    desired = undefined;
    await expect(supervisor.reconcile(TARGET)).resolves.toMatchObject({ status: 'deactivated' });
    expect(supervisor.status(TARGET)).toBeUndefined();
    await vi.waitFor(() => expect(runtime.close).toHaveBeenCalledOnce());
    await expect(supervisor.invoke({ target: TARGET, query: 'handler', argument: null }))
      .rejects.toMatchObject({ code: 'HQ_RUNTIME_NOT_READY' });
    await supervisor.close();
  });

  it('forces isolation shutdown when in-flight work exceeds the drain deadline', async () => {
    const first = snapshot('a');
    const second = snapshot('b');
    let desired = first;
    const source = materializer(async () => desired);
    const firstRuntime = runtimeInstance('v1');
    const secondRuntime = runtimeInstance('v2');
    const pending = deferred<unknown>();
    firstRuntime.invoke.mockImplementationOnce(async () => pending.promise);
    const supervisor = createDeploymentRuntimeSupervisor({
      materializer: source,
      factory: {
        start: async candidate => candidate === first
          ? firstRuntime.instance
          : secondRuntime.instance,
      },
      drainTimeoutMs: 0,
    });
    await supervisor.reconcile(TARGET);
    const invocation = supervisor.invoke({ target: TARGET, query: 'handler', argument: null });
    await vi.waitFor(() => expect(firstRuntime.invoke).toHaveBeenCalledOnce());

    desired = second;
    await supervisor.reconcile(TARGET);
    await vi.waitFor(() => expect(firstRuntime.close).toHaveBeenCalledOnce());

    pending.resolve('finished-after-deadline');
    await expect(invocation).resolves.toBe('finished-after-deadline');
    await supervisor.close();
  });

  it('attempts every runtime close and reports explicit shutdown failures', async () => {
    const active = snapshot('c');
    const runtime = runtimeInstance('v1');
    runtime.close.mockRejectedValueOnce(new Error('close failed'));
    const supervisor = createDeploymentRuntimeSupervisor({
      materializer: materializer(async () => active),
      factory: { start: async () => runtime.instance },
    });
    await supervisor.reconcile(TARGET);

    await expect(supervisor.close()).rejects.toBeInstanceOf(AggregateError);
    expect(runtime.close).toHaveBeenCalledOnce();
  });

  it('shares one shutdown promise across concurrent close calls', async () => {
    const active = snapshot('e');
    const runtime = runtimeInstance('v1');
    const closing = deferred<void>();
    runtime.close.mockImplementationOnce(async () => closing.promise);
    const supervisor = createDeploymentRuntimeSupervisor({
      materializer: materializer(async () => active),
      factory: { start: async () => runtime.instance },
    });
    await supervisor.reconcile(TARGET);

    const first = supervisor.close();
    const second = supervisor.close();

    expect(second).toBe(first);
    await vi.waitFor(() => expect(runtime.close).toHaveBeenCalledOnce());
    closing.resolve();
    await expect(Promise.all([first, second])).resolves.toEqual([undefined, undefined]);
  });

  it('rejects portable queries and becomes permanently closed', async () => {
    const active = snapshot('9', true);
    const runtime = runtimeInstance('portable');
    const supervisor = createDeploymentRuntimeSupervisor({
      materializer: materializer(async () => active),
      factory: { start: async () => runtime.instance },
    });
    await supervisor.reconcile(TARGET);

    await expect(supervisor.invoke({ target: TARGET, query: 'handler', argument: null }))
      .rejects.toMatchObject({ code: 'HQ_RUNTIME_QUERY_NOT_EXECUTABLE' });
    await supervisor.close();
    await expect(supervisor.reconcile(TARGET)).rejects.toBeInstanceOf(
      DeploymentRuntimeSupervisorError,
    );
  });
});
