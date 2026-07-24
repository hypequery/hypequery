import { createHash } from 'node:crypto';
import { chmod, mkdtemp, readdir, rm, stat } from 'node:fs/promises';
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
  options: {
    readonly runtime?: 'node' | 'python';
    readonly entrypoint?: string;
    readonly digest?: string;
    readonly target?: { readonly project: string; readonly environment: string };
  } = {},
): DeploymentRuntimeSnapshot {
  const bytes = Buffer.from(source);
  const runtime = options.runtime ?? 'node';
  const artifactSha256 = options.digest ?? sha256(bytes);
  const entrypoint = options.entrypoint ?? 'queries.handler';
  const target = options.target ?? TARGET;
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
    target,
    activation: Object.freeze({
      kind: 'hypequery-deployment-activation',
      version: 1,
      revision: '1'.repeat(64),
      target,
      releaseIdentity: '2'.repeat(64),
      previousRevision: null,
      previousReleaseIdentity: null,
      activatedAt: '2026-07-19T12:00:00.000Z',
    }),
    release: Object.freeze({
      kind: 'hypequery-deployment-release',
      version: 1,
      bundleIdentity: '3'.repeat(64),
      target,
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

  it('injects one explicit environment per snapshot without mutating the parent process', async () => {
    const directory = await temporaryDirectory();
    const parentKey = 'HQ_NODE_RUNTIME_PARENT_TEST';
    const secretKey = 'HQ_NODE_RUNTIME_SECRET_TEST';
    const previousParent = process.env[parentKey];
    const previousSecret = process.env[secretKey];
    process.env[parentKey] = 'parent-only';
    delete process.env[secretKey];
    try {
      const source = [
        'export const queries = {',
        '  handler: async () => ({',
        `    parent: process.env.${parentKey} ?? null,`,
        `    secret: process.env.${secretKey} ?? null,`,
        '    project: process.env.HQ_NODE_RUNTIME_PROJECT ?? null,',
        '  }),',
        '};',
        '',
      ].join('\n');
      const production = snapshot(source, {
        target: { project: 'analytics', environment: 'production' },
      });
      const preview = snapshot(source, {
        target: { project: 'analytics', environment: 'preview' },
      });
      const resolutions: string[] = [];
      const factory = createNodeWorkerDeploymentRuntimeFactory({
        temporaryDirectory: directory,
        async resolveEnvironment(deployed) {
          resolutions.push(deployed.target.environment);
          return {
            [secretKey]: `${deployed.target.environment}-secret`,
            HQ_NODE_RUNTIME_PROJECT: deployed.target.project,
          };
        },
      });

      const [productionInstance, previewInstance] = await Promise.all([
        factory.start(production, {}),
        factory.start(preview, {}),
      ]);
      instances.push(productionInstance, previewInstance);
      const invoke = (instance: DeploymentRuntimeInstance, deployed: DeploymentRuntimeSnapshot) => (
        instance.invoke({
          query: 'handler',
          binding: deployed.queries[0]!,
          argument: {},
        })
      );

      await expect(invoke(productionInstance, production)).resolves.toEqual({
        parent: null,
        secret: 'production-secret',
        project: 'analytics',
      });
      await expect(invoke(previewInstance, preview)).resolves.toEqual({
        parent: null,
        secret: 'preview-secret',
        project: 'analytics',
      });
      expect(resolutions.sort()).toEqual(['preview', 'production']);
      expect(process.env[parentKey]).toBe('parent-only');
      expect(process.env[secretKey]).toBeUndefined();
    } finally {
      if (previousParent === undefined) delete process.env[parentKey];
      else process.env[parentKey] = previousParent;
      if (previousSecret === undefined) delete process.env[secretKey];
      else process.env[secretKey] = previousSecret;
    }
  });

  it('inherits the parent environment when no resolver is configured', async () => {
    const directory = await temporaryDirectory();
    const key = 'HQ_NODE_RUNTIME_INHERIT_TEST';
    const previous = process.env[key];
    process.env[key] = 'inherited';
    try {
      const deployed = snapshot([
        'export const queries = {',
        `  handler: async () => process.env.${key} ?? null,`,
        '};',
        '',
      ].join('\n'));
      const factory = createNodeWorkerDeploymentRuntimeFactory({
        temporaryDirectory: directory,
      });
      const instance = await factory.start(deployed, {});
      instances.push(instance);

      await expect(instance.invoke({
        query: 'handler',
        binding: deployed.queries[0]!,
        argument: {},
      })).resolves.toBe('inherited');
    } finally {
      if (previous === undefined) delete process.env[key];
      else process.env[key] = previous;
    }
  });

  it('rejects invalid or failed environment resolution and removes temporary bytes', async () => {
    const directory = await temporaryDirectory();
    const deployed = snapshot('export const queries = { handler: () => true };\n');
    const invalid = createNodeWorkerDeploymentRuntimeFactory({
      temporaryDirectory: directory,
      resolveEnvironment: async () => ({ SECRET: 42 }) as unknown as Record<string, string>,
    });
    const failed = createNodeWorkerDeploymentRuntimeFactory({
      temporaryDirectory: directory,
      resolveEnvironment: async () => {
        throw new Error('provider failure');
      },
    });

    await expect(invalid.start(deployed, {})).rejects.toMatchObject({
      code: 'HQ_NODE_RUNTIME_START_FAILED',
      message: 'The Node deployment runtime environment is invalid.',
    });
    await expect(failed.start(deployed, {})).rejects.toMatchObject({
      code: 'HQ_NODE_RUNTIME_START_FAILED',
      message: 'The Node deployment runtime environment could not be resolved.',
    });
    expect(await readdir(directory)).toEqual([]);
  });

  it('passes the startup abort signal through environment resolution', async () => {
    const directory = await temporaryDirectory();
    const deployed = snapshot('export const queries = { handler: () => true };\n');
    const controller = new AbortController();
    let markResolverStarted!: () => void;
    const resolverStarted = new Promise<void>(resolve => {
      markResolverStarted = resolve;
    });
    const factory = createNodeWorkerDeploymentRuntimeFactory({
      temporaryDirectory: directory,
      resolveEnvironment: async (_snapshot, { signal }) => {
        markResolverStarted();
        return await new Promise<Record<string, string>>((_resolve, reject) => {
          signal?.addEventListener('abort', () => reject(signal.reason), { once: true });
          if (signal?.aborted) reject(signal.reason);
        });
      },
    });

    const starting = factory.start(deployed, { signal: controller.signal });
    await resolverStarted;
    controller.abort(new Error('cancel environment lookup'));

    await expect(starting).rejects.toMatchObject({ code: 'HQ_NODE_RUNTIME_ABORTED' });
    expect(await readdir(directory)).toEqual([]);
  });

  it('detects aborts between environment resolution and worker startup', async () => {
    const directory = await temporaryDirectory();
    const deployed = snapshot('export const queries = { handler: () => true };\n');
    const controller = new AbortController();
    const reason = new Error('cancel before worker creation');
    const environment = new Proxy<Record<string, string>>(
      { SAFE: 'value' },
      {
        ownKeys(target) {
          queueMicrotask(() => controller.abort(reason));
          return Reflect.ownKeys(target);
        },
      },
    );
    const factory = createNodeWorkerDeploymentRuntimeFactory({
      temporaryDirectory: directory,
      resolveEnvironment: async () => environment,
    });

    await expect(
      factory.start(deployed, { signal: controller.signal }),
    ).rejects.toMatchObject({
      code: 'HQ_NODE_RUNTIME_ABORTED',
      cause: reason,
    });
    expect(await readdir(directory)).toEqual([]);
  });

  it.skipIf(process.platform === 'win32')(
    'seals generated runtime directories before writing artifacts',
    async () => {
      const directory = await temporaryDirectory();
      await chmod(directory, 0o755);
      const deployed = snapshot('export const queries = { handler: () => true };\n');
      const factory = createNodeWorkerDeploymentRuntimeFactory({ temporaryDirectory: directory });

      const instance = await factory.start(deployed, {});
      instances.push(instance);
      const entries = await readdir(directory);

      expect(entries).toHaveLength(1);
      expect((await stat(path.join(directory, entries[0]!))).mode & 0o777).toBe(0o700);
    },
  );

  it('rejects unsupported or identity-mismatched artifacts before execution', async () => {
    const directory = await temporaryDirectory();
    let environmentResolutions = 0;
    const factory = createNodeWorkerDeploymentRuntimeFactory({
      temporaryDirectory: directory,
      resolveEnvironment: async () => {
        environmentResolutions += 1;
        return {};
      },
    });
    const python = snapshot('print("hello")\n', { runtime: 'python' });
    const mismatched = snapshot('export const queries = {};\n', { digest: 'f'.repeat(64) });

    await expect(factory.start(python, {})).rejects.toMatchObject({
      code: 'HQ_NODE_RUNTIME_UNSUPPORTED_ARTIFACT',
    });
    await expect(factory.start(mismatched, {})).rejects.toMatchObject({
      code: 'HQ_NODE_RUNTIME_INVALID_ARTIFACT',
    });
    expect(environmentResolutions).toBe(0);
    expect(await readdir(directory)).toEqual([]);
    expect(() => createNodeWorkerDeploymentRuntimeFactory({ startupTimeoutMs: 0 }))
      .toThrow(NodeDeploymentRuntimeError);
  });
});
