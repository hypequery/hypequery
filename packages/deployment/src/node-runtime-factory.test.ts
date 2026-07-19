import { createHash } from 'node:crypto';
import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { prepareProtocolDeploymentContract } from '@hypequery/protocol';
import { afterEach, describe, expect, it } from 'vitest';
import {
  createNodeWorkerDeploymentRuntimeFactory,
  NodeDeploymentRuntimeError,
} from './node-runtime-factory.js';
import type { DeploymentRuntimeSnapshot } from './runtime-materialization.js';
import type { DeploymentRuntimeInstance } from './runtime-supervisor.js';

const TARGET = Object.freeze({ project: 'analytics', environment: 'production' });
const temporaryDirectories: string[] = [];
const instances: DeploymentRuntimeInstance[] = [];

afterEach(async () => {
  await Promise.allSettled(instances.splice(0).map(instance => instance.close()));
  await Promise.all(temporaryDirectories.splice(0).map(directory => (
    rm(directory, { force: true, recursive: true })
  )));
});

async function temporaryDirectory(): Promise<string> {
  const directory = await mkdtemp(path.join(tmpdir(), 'hypequery-node-worker-test-'));
  temporaryDirectories.push(directory);
  return directory;
}

function sha256(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

function snapshot(
  source: string,
  options: { readonly runtime?: 'node' | 'python'; readonly entrypoint?: string; readonly digest?: string } = {},
): DeploymentRuntimeSnapshot {
  const bytes = Buffer.from(source);
  const runtime = options.runtime ?? 'node';
  const artifactSha256 = options.digest ?? sha256(bytes);
  const entrypoint = options.entrypoint ?? 'queries.handler';
  const binding = Object.freeze({
    query: 'handler',
    runtime,
    artifactSha256,
    entrypoint,
  });
  const deployment = prepareProtocolDeploymentContract({
    kind: 'hypequery-deployment',
    version: 1,
    datasets: [],
    queries: [{
      name: 'handler',
      input: { kind: 'any' },
      output: { kind: 'any' },
      implementation: {
        kind: 'runtime-reference',
        runtime,
        artifactSha256,
        entrypoint,
      },
      endpoint: {
        access: { kind: 'public' },
        tenant: { kind: 'not-required' },
        method: 'POST',
        path: '/handler',
      },
      tags: [],
    }],
    artifacts: [{ runtime, artifactSha256 }],
  }).contract;
  return Object.freeze({
    target: TARGET,
    activation: Object.freeze({
      kind: 'hypequery-deployment-activation',
      version: 1,
      revision: '1'.repeat(64),
      target: TARGET,
      releaseIdentity: '2'.repeat(64),
      previousRevision: null,
      previousReleaseIdentity: null,
      activatedAt: '2026-07-19T12:00:00.000Z',
    }),
    release: Object.freeze({
      kind: 'hypequery-deployment-release',
      version: 1,
      bundleIdentity: '3'.repeat(64),
      target: TARGET,
    }),
    releaseIdentity: '2'.repeat(64),
    bundleIdentity: '3'.repeat(64),
    deployment,
    artifacts: [Object.freeze({
      runtime,
      artifactSha256,
      byteLength: bytes.byteLength,
      entrypoints: Object.freeze([entrypoint]),
      read: () => Uint8Array.from(bytes),
    })],
    queries: [binding],
  });
}

describe('Node worker deployment runtime factory', () => {
  it('imports materialized modules in a worker and invokes qualified entrypoints', async () => {
    const directory = await temporaryDirectory();
    const deployed = snapshot([
      'export const queries = {',
      '  handler: async ({ value, delay = 0 }) => {',
      '    await new Promise(resolve => setTimeout(resolve, delay));',
      '    return { doubled: value * 2 };',
      '  },',
      '};',
      '',
    ].join('\n'));
    const factory = createNodeWorkerDeploymentRuntimeFactory({ temporaryDirectory: directory });
    const instance = await factory.start(deployed, {});
    instances.push(instance);

    await expect(instance.healthCheck({})).resolves.toBeUndefined();
    await expect(instance.invoke({
      query: 'handler',
      binding: deployed.queries[0]!,
      argument: { value: 21 },
    })).resolves.toEqual({ doubled: 42 });

    const dispatchedAbort = new AbortController();
    const dispatched = instance.invoke({
      query: 'handler',
      binding: deployed.queries[0]!,
      argument: { value: 2, delay: 20 },
      signal: dispatchedAbort.signal,
    });
    dispatchedAbort.abort();
    await expect(dispatched).resolves.toEqual({ doubled: 4 });

    const preDispatchAbort = new AbortController();
    preDispatchAbort.abort();
    await expect(instance.invoke({
      query: 'handler',
      binding: deployed.queries[0]!,
      argument: { value: 1 },
      signal: preDispatchAbort.signal,
    })).rejects.toMatchObject({ code: 'HQ_NODE_RUNTIME_ABORTED' });

    await instance.close();
    expect(await readdir(directory)).toEqual([]);
    await expect(instance.invoke({
      query: 'handler',
      binding: deployed.queries[0]!,
      argument: { value: 1 },
    })).rejects.toMatchObject({ code: 'HQ_NODE_RUNTIME_CLOSED' });
  });

  it('fails startup for missing entrypoints and removes temporary bytes', async () => {
    const directory = await temporaryDirectory();
    const deployed = snapshot('export const queries = {};\n');
    const factory = createNodeWorkerDeploymentRuntimeFactory({ temporaryDirectory: directory });

    await expect(factory.start(deployed, {})).rejects.toMatchObject({
      code: 'HQ_NODE_RUNTIME_START_FAILED',
    });
    expect(await readdir(directory)).toEqual([]);
  });

  it('rejects unsupported or identity-mismatched artifacts before execution', async () => {
    const directory = await temporaryDirectory();
    const factory = createNodeWorkerDeploymentRuntimeFactory({ temporaryDirectory: directory });
    const python = snapshot('print("hello")\n', { runtime: 'python' });
    const mismatched = snapshot('export const queries = {};\n', { digest: 'f'.repeat(64) });

    await expect(factory.start(python, {})).rejects.toMatchObject({
      code: 'HQ_NODE_RUNTIME_UNSUPPORTED_ARTIFACT',
    });
    await expect(factory.start(mismatched, {})).rejects.toMatchObject({
      code: 'HQ_NODE_RUNTIME_INVALID_ARTIFACT',
    });
    expect(await readdir(directory)).toEqual([]);
    expect(() => createNodeWorkerDeploymentRuntimeFactory({ startupTimeoutMs: 0 }))
      .toThrow(NodeDeploymentRuntimeError);
  });
});
