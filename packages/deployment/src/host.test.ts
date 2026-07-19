import {
  validateProtocolDeploymentContract,
  type ProtocolDeploymentContract,
} from '@hypequery/protocol';
import { describe, expect, it, vi } from 'vitest';
import { createDeploymentHost } from './host.js';
import type {
  DeploymentRuntimeGeneration,
  DeploymentRuntimeStatus,
  DeploymentRuntimeSupervisor,
} from './runtime-supervisor.js';

const TARGET = Object.freeze({ project: 'analytics', environment: 'production' });
const ARTIFACT = 'a'.repeat(64);
const RELEASE = 'b'.repeat(64);
const BUNDLE = 'c'.repeat(64);
const REVISION = 'd'.repeat(64);

function deployment(): ProtocolDeploymentContract {
  return validateProtocolDeploymentContract({
    kind: 'hypequery-deployment',
    version: 1,
    datasets: [],
    queries: [{
      name: 'orders',
      input: { kind: 'any' },
      output: { kind: 'any' },
      implementation: {
        kind: 'runtime-reference',
        runtime: 'node',
        artifactSha256: ARTIFACT,
        entrypoint: 'queries.orders',
      },
      endpoint: {
        access: { kind: 'public' },
        tenant: { kind: 'not-required' },
        method: 'POST',
        path: '/orders',
      },
      tags: [],
    }],
    artifacts: [{ runtime: 'node', artifactSha256: ARTIFACT }],
  });
}

function generation(revision = REVISION): DeploymentRuntimeGeneration {
  const status: DeploymentRuntimeStatus = Object.freeze({
    target: TARGET,
    activationRevision: revision,
    releaseIdentity: RELEASE,
    bundleIdentity: BUNDLE,
  });
  return Object.freeze({ status, deployment: deployment() });
}

function supervisor(active: { value?: DeploymentRuntimeGeneration }): DeploymentRuntimeSupervisor {
  return {
    reconcile: vi.fn(async () => active.value
      ? { status: 'already-current' as const, runtime: active.value.status }
      : { status: 'no-active-release' as const }),
    invoke: vi.fn(async invocation => ({ query: invocation.query, argument: invocation.argument })),
    status: vi.fn(() => active.value?.status),
    generation: vi.fn(() => active.value),
    close: vi.fn(async () => undefined),
  };
}

describe('deployment host', () => {
  it('installs and invokes one activation-pinned data-plane generation', async () => {
    const active = { value: generation() };
    const runtime = supervisor(active);
    const host = createDeploymentHost({
      supervisor: runtime,
      configureDataPlane: async () => ({
        runtimeArgument: ({ input }) => ({ input }),
      }),
    });

    await expect(host.start([TARGET])).resolves.toEqual([{
      status: 'already-current',
      runtime: active.value.status,
    }]);
    await expect(host.execute(TARGET, {
      method: 'POST',
      path: '/orders',
      input: { state: 'paid' },
    })).resolves.toEqual({
      query: 'orders',
      output: { query: 'orders', argument: { input: { state: 'paid' } } },
    });
    expect(runtime.invoke).toHaveBeenCalledWith(expect.objectContaining({
      target: TARGET,
      activationRevision: REVISION,
      query: 'orders',
    }));
    expect(host.status(TARGET)).toEqual(active.value.status);
  });

  it('retries when activation changes while a data plane is being configured', async () => {
    const first = generation('1'.repeat(64));
    const second = generation('2'.repeat(64));
    const active = { value: first };
    const runtime = supervisor(active);
    const configureDataPlane = vi.fn(async ({ status }) => {
      if (status.activationRevision === first.status.activationRevision) active.value = second;
      return { runtimeArgument: ({ input }: { input: unknown }) => input };
    });
    const host = createDeploymentHost({ supervisor: runtime, configureDataPlane });

    await host.reconcile(TARGET);

    expect(configureDataPlane).toHaveBeenCalledTimes(2);
    expect(host.status(TARGET)?.activationRevision).toBe(second.status.activationRevision);
  });

  it('removes inactive targets and makes concurrent close callers await one shutdown', async () => {
    const active: { value?: DeploymentRuntimeGeneration } = { value: generation() };
    const runtime = supervisor(active);
    let releaseClose!: () => void;
    runtime.close = vi.fn(() => new Promise<void>(resolve => { releaseClose = resolve; }));
    const host = createDeploymentHost({
      supervisor: runtime,
      configureDataPlane: () => ({ runtimeArgument: ({ input }) => input }),
    });
    await host.reconcile(TARGET);
    active.value = undefined;
    await host.reconcile(TARGET);
    expect(() => host.dataPlane(TARGET)).not.toThrow();
    await expect(host.dataPlane(TARGET).execute({ method: 'POST', path: '/orders' }))
      .rejects.toMatchObject({ code: 'HQ_DEPLOYMENT_HOST_NOT_READY' });

    const first = host.close();
    const second = host.close();
    let secondSettled = false;
    void second.then(() => { secondSettled = true; });
    await vi.waitFor(() => expect(runtime.close).toHaveBeenCalledOnce());
    expect(secondSettled).toBe(false);
    releaseClose();
    await expect(Promise.all([first, second])).resolves.toEqual([undefined, undefined]);
  });
});
