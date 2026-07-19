import { createHash } from 'node:crypto';
import {
  mkdir,
  mkdtemp,
  open,
  readFile,
  readdir,
  rm,
  symlink,
  type FileHandle,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  prepareProtocolDeploymentBundleManifest,
  prepareProtocolDeploymentContract,
  prepareProtocolDeploymentReleaseEnvelope,
  type ProtocolDeploymentReleaseTarget,
} from '@hypequery/protocol';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createFileSystemDeploymentActivationRegistry,
  DeploymentActivationError,
} from './activation.js';
import { verifyDeploymentBundle } from './bundle.js';
import { createFileSystemDeploymentSubmissionStore } from './filesystem-store.js';
import type { VerifiedDeploymentSubmission } from './types.js';

const target: ProtocolDeploymentReleaseTarget = Object.freeze({
  project: 'analytics',
  environment: 'production',
});
const temporaryDirectories: string[] = [];

async function temporaryDirectory(prefix: string): Promise<string> {
  const directory = await mkdtemp(path.join(tmpdir(), prefix));
  temporaryDirectories.push(directory);
  return directory;
}

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map(directory => (
    rm(directory, { force: true, recursive: true })
  )));
});

function sha256(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

async function submissionFixture(
  name: string,
  releaseTarget = target,
): Promise<{
  readonly deploymentPath: string;
  readonly submission: VerifiedDeploymentSubmission<string>;
}> {
  const source = await temporaryDirectory('hypequery-activation-source-');
  const deploymentPath = 'contract/deployment.json';
  const deployment = prepareProtocolDeploymentContract({
    kind: 'hypequery-deployment',
    version: 1,
    datasets: [{
      name,
      source: name,
      tenant: { kind: 'not-required' },
      dimensions: [],
      measures: [],
      filters: [],
      metrics: [],
      relationships: [],
    }],
    queries: [],
    artifacts: [],
  });
  const deploymentBytes = Buffer.from(`${deployment.canonical}\n`);
  const manifest = prepareProtocolDeploymentBundleManifest({
    kind: 'hypequery-deployment-bundle',
    version: 1,
    deployment: {
      path: deploymentPath,
      identity: deployment.identity,
      sha256: sha256(deploymentBytes),
      byteLength: deploymentBytes.byteLength,
    },
    artifacts: [],
  });
  await mkdir(path.join(source, 'contract'), { recursive: true });
  await writeFile(path.join(source, 'bundle.json'), `${manifest.canonical}\n`);
  await writeFile(path.join(source, deploymentPath), deploymentBytes);
  const bundle = await verifyDeploymentBundle(source);
  const release = prepareProtocolDeploymentReleaseEnvelope({
    kind: 'hypequery-deployment-release',
    version: 1,
    bundleIdentity: bundle.identity,
    target: releaseTarget,
  });
  return {
    deploymentPath,
    submission: {
      principal: 'principal',
      release: release.release,
      releaseCanonical: release.canonical,
      releaseIdentity: release.identity,
      bundle,
    },
  };
}

async function setup() {
  const root = await temporaryDirectory('hypequery-activation-store-');
  const releases = createFileSystemDeploymentSubmissionStore<string>({ directory: root });
  const first = await submissionFixture('orders');
  const second = await submissionFixture('customers');
  await releases.accept(first.submission);
  await releases.accept(second.submission);
  let tick = 0;
  const registry = createFileSystemDeploymentActivationRegistry({
    directory: root,
    releases,
    clock: () => new Date(Date.UTC(2026, 0, 1, 0, 0, tick++)),
  });
  const otherRegistry = createFileSystemDeploymentActivationRegistry({
    directory: root,
    releases,
    clock: () => new Date(Date.UTC(2026, 0, 2)),
  });
  return { first, second, registry, otherRegistry, releases, root };
}

function expectActivationCode(
  promise: Promise<unknown>,
  code: DeploymentActivationError['code'],
): Promise<void> {
  return expect(promise).rejects.toMatchObject({
    name: 'DeploymentActivationError',
    code,
  });
}

async function targetDirectory(root: string): Promise<string> {
  const entries = await readdir(path.join(root, 'activations'));
  const key = entries.find(entry => /^[0-9a-f]{64}$/.test(entry));
  if (!key) throw new Error('Expected an activation target directory.');
  return path.join(root, 'activations', key);
}

describe('filesystem deployment activation registry', () => {
  it('returns no current record before the first successful comparison', async () => {
    const { first, registry } = await setup();

    await expect(registry.current(target)).resolves.toBeUndefined();
    await expect(registry.history(target)).resolves.toEqual([]);
    await expect(registry.activate({
      target,
      releaseIdentity: first.submission.releaseIdentity,
      expectedRevision: '0'.repeat(64),
    })).resolves.toEqual({ status: 'conflict', current: null });
    await expect(registry.current(target)).resolves.toBeUndefined();
  });

  it.skipIf(process.platform === 'win32')(
    'syncs newly created activation directories only once',
    async () => {
      const root = await temporaryDirectory('hypequery-activation-store-');
      const probe = await open(root, 'r');
      const prototype = Object.getPrototypeOf(probe) as FileHandle;
      await probe.close();
      const sync = vi.spyOn(prototype, 'sync');
      const registry = createFileSystemDeploymentActivationRegistry({
        directory: root,
        releases: { read: async () => undefined },
      });

      try {
        await registry.current(target);
        const initializationSyncs = sync.mock.calls.length;
        expect(initializationSyncs).toBeGreaterThan(0);

        await registry.history(target);
        expect(sync).toHaveBeenCalledTimes(initializationSyncs);
      } finally {
        sync.mockRestore();
      }
    },
  );

  it('activates an accepted release with an immutable target-scoped record', async () => {
    const { first, registry, root } = await setup();

    const result = await registry.activate({
      target,
      releaseIdentity: first.submission.releaseIdentity,
      expectedRevision: null,
    });

    expect(result.status).toBe('activated');
    if (result.status !== 'activated') throw new Error('Expected activation.');
    expect(result.activation).toMatchObject({
      kind: 'hypequery-deployment-activation',
      version: 1,
      target,
      releaseIdentity: first.submission.releaseIdentity,
      previousRevision: null,
      previousReleaseIdentity: null,
      activatedAt: '2026-01-01T00:00:00.000Z',
    });
    expect(result.activation.revision).toMatch(/^[0-9a-f]{64}$/);
    expect(Object.isFrozen(result.activation)).toBe(true);
    await expect(registry.current(target)).resolves.toEqual(result.activation);
    const history = await registry.history(target);
    expect(history).toEqual([result.activation]);
    expect(Object.isFrozen(history)).toBe(true);
    expect(await readdir(path.join(await targetDirectory(root), 'claims'))).toEqual(['initial']);
  });

  it('treats an already-active release as idempotent regardless of a stale expectation', async () => {
    const { first, registry } = await setup();
    const activated = await registry.activate({
      target,
      releaseIdentity: first.submission.releaseIdentity,
      expectedRevision: null,
    });
    if (activated.status !== 'activated') throw new Error('Expected activation.');

    const replay = await registry.activate({
      target,
      releaseIdentity: first.submission.releaseIdentity,
      expectedRevision: '0'.repeat(64),
    });

    expect(replay).toEqual({ status: 'already-active', activation: activated.activation });
    expect(await registry.history(target)).toHaveLength(1);
  });

  it('supports forward activation and rollback without an ABA revision', async () => {
    const { first, second, registry } = await setup();
    const initial = await registry.activate({
      target,
      releaseIdentity: first.submission.releaseIdentity,
      expectedRevision: null,
    });
    if (initial.status !== 'activated') throw new Error('Expected activation.');
    const forward = await registry.activate({
      target,
      releaseIdentity: second.submission.releaseIdentity,
      expectedRevision: initial.activation.revision,
    });
    if (forward.status !== 'activated') throw new Error('Expected activation.');

    const rollback = await registry.activate({
      target,
      releaseIdentity: first.submission.releaseIdentity,
      expectedRevision: forward.activation.revision,
    });

    expect(rollback.status).toBe('activated');
    if (rollback.status !== 'activated') throw new Error('Expected rollback.');
    expect(rollback.activation.previousRevision).toBe(forward.activation.revision);
    expect(rollback.activation.previousReleaseIdentity)
      .toBe(second.submission.releaseIdentity);
    expect(rollback.activation.revision).not.toBe(initial.activation.revision);
    expect((await registry.history(target)).map(record => record.releaseIdentity)).toEqual([
      first.submission.releaseIdentity,
      second.submission.releaseIdentity,
      first.submission.releaseIdentity,
    ]);
    const newest = await registry.historyPage(target, { limit: 1 });
    const older = await registry.historyPage(target, {
      limit: 1,
      before: newest.nextBefore!,
    });
    const oldest = await registry.historyPage(target, {
      limit: 1,
      before: older.nextBefore!,
    });
    expect(newest).toEqual({ activations: [rollback.activation], nextBefore: rollback.activation.revision });
    expect(older).toEqual({ activations: [forward.activation], nextBefore: forward.activation.revision });
    expect(oldest).toEqual({ activations: [initial.activation], nextBefore: null });
    expect(Object.isFrozen(newest.activations)).toBe(true);
    await expectActivationCode(
      registry.historyPage(target, { limit: 1, before: 'f'.repeat(64) }),
      'HQ_DEPLOYMENT_ACTIVATION_INVALID_REQUEST',
    );
  });

  it('returns the current record on a compare-and-swap conflict', async () => {
    const { first, second, registry } = await setup();
    const initial = await registry.activate({
      target,
      releaseIdentity: first.submission.releaseIdentity,
      expectedRevision: null,
    });
    if (initial.status !== 'activated') throw new Error('Expected activation.');

    await expect(registry.activate({
      target,
      releaseIdentity: second.submission.releaseIdentity,
      expectedRevision: null,
    })).resolves.toEqual({ status: 'conflict', current: initial.activation });
  });

  it('allows exactly one of two concurrent transitions from the same revision', async () => {
    const { first, second, registry, otherRegistry } = await setup();

    const results = await Promise.all([
      otherRegistry.activate({
        target,
        releaseIdentity: first.submission.releaseIdentity,
        expectedRevision: null,
      }),
      registry.activate({
        target,
        releaseIdentity: second.submission.releaseIdentity,
        expectedRevision: null,
      }),
    ]);

    expect(results.map(result => result.status).sort()).toEqual(['activated', 'conflict']);
    const current = await registry.current(target);
    expect(current?.releaseIdentity).toBe(
      results.find(result => result.status === 'activated')!.activation.releaseIdentity,
    );
    expect(await registry.history(target)).toHaveLength(1);
  });

  it('coalesces concurrent requests for the same release', async () => {
    const { first, registry, otherRegistry } = await setup();

    const results = await Promise.all([
      otherRegistry.activate({
        target,
        releaseIdentity: first.submission.releaseIdentity,
        expectedRevision: null,
      }),
      registry.activate({
        target,
        releaseIdentity: first.submission.releaseIdentity,
        expectedRevision: null,
      }),
    ]);

    expect(results.map(result => result.status).sort())
      .toEqual(['activated', 'already-active']);
    expect(await registry.history(target)).toHaveLength(1);
  });

  it('requires the release to exist and match the requested target', async () => {
    const { first, registry, releases, root } = await setup();
    await expectActivationCode(
      registry.activate({
        target,
        releaseIdentity: '0'.repeat(64),
        expectedRevision: null,
      }),
      'HQ_DEPLOYMENT_ACTIVATION_RELEASE_NOT_FOUND',
    );
    const otherTarget = Object.freeze({ project: 'analytics', environment: 'staging' });
    await expectActivationCode(
      registry.activate({
        target: otherTarget,
        releaseIdentity: first.submission.releaseIdentity,
        expectedRevision: null,
      }),
      'HQ_DEPLOYMENT_ACTIVATION_TARGET_MISMATCH',
    );

    const storedDeployment = path.join(
      root,
      'bundles',
      first.submission.bundle.identity,
      ...first.deploymentPath.split('/'),
    );
    await writeFile(storedDeployment, 'corrupt');
    const unavailable = createFileSystemDeploymentActivationRegistry({
      directory: root,
      releases,
    });
    await expectActivationCode(
      unavailable.activate({
        target,
        releaseIdentity: first.submission.releaseIdentity,
        expectedRevision: null,
      }),
      'HQ_DEPLOYMENT_ACTIVATION_RELEASE_UNAVAILABLE',
    );

    const inconsistent = createFileSystemDeploymentActivationRegistry({
      directory: await temporaryDirectory('hypequery-activation-inconsistent-'),
      releases: {
        read: async () => ({
          release: first.submission.release,
          releaseIdentity: 'f'.repeat(64),
        }),
      },
    });
    await expectActivationCode(
      inconsistent.activate({
        target,
        releaseIdentity: first.submission.releaseIdentity,
        expectedRevision: null,
      }),
      'HQ_DEPLOYMENT_ACTIVATION_RELEASE_UNAVAILABLE',
    );
  });

  it('rejects malformed request identities before touching state', async () => {
    const { first, registry } = await setup();

    await expectActivationCode(
      registry.activate({
        target,
        releaseIdentity: first.submission.releaseIdentity,
        expectedRevision: undefined as unknown as string,
      }),
      'HQ_DEPLOYMENT_ACTIVATION_INVALID_REQUEST',
    );
  });

  it('detects non-canonical or tampered activation records', async () => {
    const { first, registry, root } = await setup();
    await registry.activate({
      target,
      releaseIdentity: first.submission.releaseIdentity,
      expectedRevision: null,
    });
    const activationFile = path.join(
      await targetDirectory(root),
      'claims',
      'initial',
      'activation.json',
    );
    const value = JSON.parse(await readFile(activationFile, 'utf8')) as Record<string, unknown>;
    await writeFile(activationFile, JSON.stringify({ ...value, revision: '0'.repeat(64) }));

    await expectActivationCode(
      registry.current(target),
      'HQ_DEPLOYMENT_ACTIVATION_CORRUPT_STATE',
    );
  });

  it('detects unreachable claims instead of silently choosing a head', async () => {
    const { first, registry, root } = await setup();
    await registry.activate({
      target,
      releaseIdentity: first.submission.releaseIdentity,
      expectedRevision: null,
    });
    await mkdir(path.join(
      await targetDirectory(root),
      'claims',
      'f'.repeat(64),
    ));

    await expectActivationCode(
      registry.history(target),
      'HQ_DEPLOYMENT_ACTIVATION_CORRUPT_STATE',
    );
  });

  it('ignores an uncommitted staging directory left by an interrupted writer', async () => {
    const { first, registry, root } = await setup();
    const activated = await registry.activate({
      target,
      releaseIdentity: first.submission.releaseIdentity,
      expectedRevision: null,
    });
    await mkdir(path.join(root, 'activations', '.activation-staging-interrupted'));

    await expect(registry.current(target)).resolves.toEqual(
      activated.status === 'activated' ? activated.activation : undefined,
    );
  });

  it.skipIf(process.platform === 'win32')(
    'rejects a symbolic-link claim in the committed history',
    async () => {
      const { first, second, registry, root } = await setup();
      const activated = await registry.activate({
        target,
        releaseIdentity: first.submission.releaseIdentity,
        expectedRevision: null,
      });
      if (activated.status !== 'activated') throw new Error('Expected activation.');
      const external = await temporaryDirectory('hypequery-activation-external-');
      await symlink(
        external,
        path.join(
          await targetDirectory(root),
          'claims',
          activated.activation.revision,
        ),
        'dir',
      );

      await expectActivationCode(
        registry.activate({
          target,
          releaseIdentity: second.submission.releaseIdentity,
          expectedRevision: activated.activation.revision,
        }),
        'HQ_DEPLOYMENT_ACTIVATION_CORRUPT_STATE',
      );
    },
  );
});
