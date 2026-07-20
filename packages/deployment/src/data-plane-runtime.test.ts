import { describe, expect, it, vi } from 'vitest';
import type { DeploymentRuntimeSupervisor } from './runtime-supervisor.js';
import { createDeploymentRuntimeSupervisorExecutor } from './data-plane-runtime.js';

describe('deployment data-plane runtime supervisor executor', () => {
  it('pins dispatch to the data plane activation revision', async () => {
    const invoke = vi.fn(async () => 'ok');
    const supervisor = { invoke } as unknown as DeploymentRuntimeSupervisor;
    const target = { project: 'analytics', environment: 'production' } as const;
    const execute = createDeploymentRuntimeSupervisorExecutor({
      supervisor,
      target,
      activationRevision: 'a'.repeat(64),
      argument: input => ({ input: input.input, tenant: input.tenant }),
    });
    const execution = {
      query: { name: 'handler' },
      input: { id: 'order-1' },
      tenant: 'tenant-1',
      signal: undefined,
    } as Parameters<typeof execute>[0];

    await expect(execute(execution)).resolves.toBe('ok');
    expect(invoke).toHaveBeenCalledWith({
      target,
      activationRevision: 'a'.repeat(64),
      query: 'handler',
      argument: { input: { id: 'order-1' }, tenant: 'tenant-1' },
      signal: undefined,
    });
  });
});
