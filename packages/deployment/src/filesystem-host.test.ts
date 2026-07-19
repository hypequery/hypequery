import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createFileSystemDeploymentHost } from './filesystem-host.js';
import type { DeploymentRuntimeFactory } from './runtime-supervisor.js';

const TARGET = Object.freeze({ project: 'analytics', environment: 'production' });
const directories: string[] = [];

afterEach(async () => {
  await Promise.all(directories.splice(0).map(directory => (
    rm(directory, { force: true, recursive: true })
  )));
});

async function temporaryDirectory(): Promise<string> {
  const directory = await mkdtemp(path.join(tmpdir(), 'hypequery-filesystem-host-test-'));
  directories.push(directory);
  return directory;
}

describe('filesystem deployment host', () => {
  it('assembles durable control, activation, runtime, and data-plane components', async () => {
    const runtimeFactory: DeploymentRuntimeFactory = {
      start: vi.fn(async () => { throw new Error('No inactive runtime should start.'); }),
    };
    const service = createFileSystemDeploymentHost({
      directory: await temporaryDirectory(),
      targets: [TARGET],
      intake: {
        authenticator: { authenticate: async () => 'deployer' },
        authorizer: { authorize: async () => true },
      },
      controlPlane: {
        authenticator: { authenticate: async () => 'operator' },
        authorizer: { authorize: async () => true },
      },
      runtimeFactory,
      configureDataPlane: () => ({ runtimeArgument: ({ input }) => input }),
    });

    await expect(service.start()).resolves.toBeUndefined();
    expect(runtimeFactory.start).not.toHaveBeenCalled();
    expect(service.supervisor.status(TARGET)).toBeUndefined();
    await expect(service.host.execute(TARGET, { method: 'POST', path: '/missing' }))
      .rejects.toMatchObject({ code: 'HQ_DEPLOYMENT_HOST_NOT_READY' });
    await expect(service.close()).resolves.toBeUndefined();
  });

  it('rejects ambiguous default and custom runtime-factory configuration', async () => {
    const directory = await temporaryDirectory();
    expect(() => createFileSystemDeploymentHost({
      directory,
      targets: [],
      intake: {
        authenticator: { authenticate: async () => 'deployer' },
        authorizer: { authorize: async () => true },
      },
      controlPlane: {
        authenticator: { authenticate: async () => 'operator' },
        authorizer: { authorize: async () => true },
      },
      runtimeFactory: { start: async () => { throw new Error('unused'); } },
      nodeRuntime: {},
      configureDataPlane: () => ({ runtimeArgument: ({ input }) => input }),
    })).toThrow('runtimeFactory and nodeRuntime cannot both be configured');
  });
});
