import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  prepareProtocolDeploymentBundleManifest,
  prepareProtocolDeploymentContract,
  prepareProtocolDeploymentReleaseEnvelope,
} from '@hypequery/protocol';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type {
  DeploymentActivationRecord,
  DeploymentActivationRegistry,
} from './activation.js';
import {
  DEPLOYMENT_BUNDLE_CONTRACT,
  DEPLOYMENT_BUNDLE_MANIFEST,
  verifyDeploymentBundle,
} from './bundle.js';
import {
  createDeploymentRuntimeMaterializer,
  DeploymentRuntimeMaterializationError,
  type DeploymentRuntimeRelease,
} from './runtime-materialization.js';

const TARGET = Object.freeze({ project: 'analytics', environment: 'production' });
const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map(directory => (
    rm(directory, { force: true, recursive: true })
  )));
});

function sha256(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

async function releaseFixture(source: string): Promise<{
  readonly stored: DeploymentRuntimeRelease;
  readonly artifactPath: string;
  readonly artifactBytes: Uint8Array;
}> {
  const directory = await mkdtemp(path.join(tmpdir(), 'hypequery-runtime-materialization-'));
  temporaryDirectories.push(directory);
  const artifactBytes = Buffer.from(source);
  const artifactSha256 = sha256(artifactBytes);
  const preparedDeployment = prepareProtocolDeploymentContract({
    kind: 'hypequery-deployment',
    version: 1,
    datasets: [],
    queries: [{
      name: 'handler',
      input: { kind: 'any' },
      output: { kind: 'any' },
      implementation: {
        kind: 'runtime-reference',
        runtime: 'node',
        artifactSha256,
        entrypoint: 'queries.handler',
      },
      endpoint: {
        access: { kind: 'public' },
        tenant: { kind: 'not-required' },
        method: 'POST',
        path: '/handler',
      },
      tags: [],
    }],
    artifacts: [{ runtime: 'node', artifactSha256 }],
  });
  const deploymentBytes = Buffer.from(`${preparedDeployment.canonical}\n`);
  const artifactPath = `artifacts/${artifactSha256}.mjs`;
  const preparedManifest = prepareProtocolDeploymentBundleManifest({
    kind: 'hypequery-deployment-bundle',
    version: 1,
    deployment: {
      path: DEPLOYMENT_BUNDLE_CONTRACT,
      identity: preparedDeployment.identity,
      sha256: sha256(deploymentBytes),
      byteLength: deploymentBytes.byteLength,
    },
    artifacts: [{
      runtime: 'node',
      path: artifactPath,
      sha256: artifactSha256,
      byteLength: artifactBytes.byteLength,
    }],
  });
  await mkdir(path.join(directory, 'artifacts'));
  await writeFile(path.join(directory, DEPLOYMENT_BUNDLE_CONTRACT), deploymentBytes);
  await writeFile(path.join(directory, artifactPath), artifactBytes);
  await writeFile(path.join(directory, DEPLOYMENT_BUNDLE_MANIFEST), `${preparedManifest.canonical}\n`);
  const bundle = await verifyDeploymentBundle(directory);
  const preparedRelease = prepareProtocolDeploymentReleaseEnvelope({
    kind: 'hypequery-deployment-release',
    version: 1,
    bundleIdentity: bundle.identity,
    target: TARGET,
  });
  return {
    stored: Object.freeze({
      release: preparedRelease.release,
      releaseIdentity: preparedRelease.identity,
      bundle,
    }),
    artifactPath: path.join(directory, artifactPath),
    artifactBytes: Uint8Array.from(artifactBytes),
  };
}

function activation(
  releaseIdentity: string,
): DeploymentActivationRecord {
  const activatedAt = '2026-07-19T12:00:00.000Z';
  const payload = JSON.stringify({
    kind: 'hypequery-deployment-activation',
    version: 1,
    target: TARGET,
    releaseIdentity,
    previousRevision: null,
    previousReleaseIdentity: null,
    activatedAt,
  });
  return Object.freeze({
    kind: 'hypequery-deployment-activation',
    version: 1,
    revision: createHash('sha256')
      .update('hypequery:deployment-activation:v1\0')
      .update(payload)
      .digest('hex'),
    target: TARGET,
    releaseIdentity,
    previousRevision: null,
    previousReleaseIdentity: null,
    activatedAt,
  });
}

function registry(
  current: DeploymentActivationRegistry['current'],
): DeploymentActivationRegistry {
  return {
    current,
    activate: async () => { throw new Error('not used'); },
    history: async () => [],
  };
}

describe('deployment runtime materialization', () => {
  it('creates an immutable copy-on-read snapshot bound to the active revision', async () => {
    const fixture = await releaseFixture('export const queries={handler:()=>"v1"};\n');
    const active = activation(fixture.stored.releaseIdentity);
    const materializer = createDeploymentRuntimeMaterializer({
      activations: registry(async () => active),
      releases: { read: async () => fixture.stored },
    });

    const snapshot = await materializer.current(TARGET);

    expect(snapshot).toMatchObject({
      target: TARGET,
      activation: active,
      releaseIdentity: fixture.stored.releaseIdentity,
      bundleIdentity: fixture.stored.bundle.identity,
      queries: [{
        query: 'handler',
        runtime: 'node',
        artifactSha256: sha256(fixture.artifactBytes),
        entrypoint: 'queries.handler',
      }],
    });
    expect(snapshot?.artifacts[0]?.entrypoints).toEqual(['queries.handler']);
    const firstRead = snapshot!.artifacts[0]!.read();
    firstRead.fill(0);
    expect(snapshot!.artifacts[0]!.read()).toEqual(fixture.artifactBytes);
    expect(Object.isFrozen(snapshot)).toBe(true);
  });

  it('keeps materialized bytes stable after durable storage changes', async () => {
    const fixture = await releaseFixture('export const value="original";\n');
    const active = activation(fixture.stored.releaseIdentity);
    const materializer = createDeploymentRuntimeMaterializer({
      activations: registry(async () => active),
      releases: { read: async () => fixture.stored },
    });
    const snapshot = await materializer.current(TARGET);

    await writeFile(fixture.artifactPath, 'tampered after materialization');

    expect(snapshot!.artifacts[0]!.read()).toEqual(fixture.artifactBytes);
  });

  it('retries when activation changes and returns only a confirmed current snapshot', async () => {
    const first = await releaseFixture('export const version=1;\n');
    const second = await releaseFixture('export const version=2;\n');
    const activationOne = activation(first.stored.releaseIdentity);
    const activationTwo = activation(second.stored.releaseIdentity);
    const current = vi.fn()
      .mockResolvedValueOnce(activationOne)
      .mockResolvedValueOnce(activationTwo)
      .mockResolvedValueOnce(activationTwo)
      .mockResolvedValueOnce(activationTwo);
    const releases = new Map([
      [first.stored.releaseIdentity, first.stored],
      [second.stored.releaseIdentity, second.stored],
    ]);
    const materializer = createDeploymentRuntimeMaterializer({
      activations: registry(current),
      releases: { read: async identity => releases.get(identity) },
    });

    const snapshot = await materializer.current(TARGET);

    expect(snapshot?.activation).toEqual(activationTwo);
    expect(snapshot?.artifacts[0]?.read()).toEqual(second.artifactBytes);
    expect(current).toHaveBeenCalledTimes(4);
  });

  it('fails closed when the accepted release or closed bundle is inconsistent', async () => {
    const fixture = await releaseFixture('export const value=true;\n');
    const active = activation(fixture.stored.releaseIdentity);
    const missing = createDeploymentRuntimeMaterializer({
      activations: registry(async () => active),
      releases: { read: async () => undefined },
    });
    await expect(missing.current(TARGET)).rejects.toMatchObject({
      code: 'HQ_RUNTIME_MATERIALIZATION_RELEASE_NOT_FOUND',
    });

    await writeFile(fixture.artifactPath, 'tampered');
    const invalid = createDeploymentRuntimeMaterializer({
      activations: registry(async () => active),
      releases: { read: async () => fixture.stored },
    });
    await expect(invalid.current(TARGET)).rejects.toMatchObject({
      code: 'HQ_RUNTIME_MATERIALIZATION_RELEASE_INVALID',
    });

    const invalidActivation = createDeploymentRuntimeMaterializer({
      activations: registry(async () => ({ ...active, revision: '0'.repeat(64) })),
      releases: { read: async () => fixture.stored },
    });
    await expect(invalidActivation.current(TARGET)).rejects.toMatchObject({
      code: 'HQ_RUNTIME_MATERIALIZATION_ACTIVATION_UNAVAILABLE',
    });
  });

  it('bounds activation churn and validates its stability configuration', async () => {
    const first = await releaseFixture('export const version=1;\n');
    const second = await releaseFixture('export const version=2;\n');
    const values = [
      activation(first.stored.releaseIdentity),
      activation(second.stored.releaseIdentity),
    ];
    let index = 0;
    const releases = new Map([
      [first.stored.releaseIdentity, first.stored],
      [second.stored.releaseIdentity, second.stored],
    ]);
    const materializer = createDeploymentRuntimeMaterializer({
      activations: registry(async () => values[index++ % 2]),
      releases: { read: async identity => releases.get(identity) },
      maxStabilityAttempts: 2,
    });

    await expect(materializer.current(TARGET)).rejects.toBeInstanceOf(
      DeploymentRuntimeMaterializationError,
    );
    await expect(materializer.current(TARGET)).rejects.toMatchObject({
      code: 'HQ_RUNTIME_MATERIALIZATION_UNSTABLE_ACTIVATION',
    });
    expect(() => createDeploymentRuntimeMaterializer({
      activations: registry(async () => undefined),
      releases: { read: async () => undefined },
      maxStabilityAttempts: 17,
    })).toThrow(DeploymentRuntimeMaterializationError);
  });
});
