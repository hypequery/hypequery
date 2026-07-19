import { createHash } from 'node:crypto';
import {
  appendFile,
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
} from '@hypequery/protocol';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { verifyDeploymentBundle } from './bundle.js';
import {
  createFileSystemDeploymentSubmissionStore,
  FileSystemDeploymentStoreError,
} from './filesystem-store.js';
import type { VerifiedDeploymentSubmission } from './types.js';

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

async function submissionFixture(): Promise<{
  readonly source: string;
  readonly deploymentPath: string;
  readonly submission: VerifiedDeploymentSubmission<string>;
}> {
  const source = await temporaryDirectory('hypequery-store-source-');
  const deploymentPath = 'contract/deployment.json';
  const deployment = prepareProtocolDeploymentContract({
    kind: 'hypequery-deployment',
    version: 1,
    datasets: [],
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
    target: { project: 'analytics', environment: 'production' },
  });
  return {
    source,
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

function expectStoreCode(
  promise: Promise<unknown>,
  code: FileSystemDeploymentStoreError['code'],
): Promise<void> {
  return expect(promise).rejects.toMatchObject({
    name: 'FileSystemDeploymentStoreError',
    code,
  });
}

describe('filesystem deployment submission store', () => {
  it('atomically persists a submission independently of its temporary source', async () => {
    const fixture = await submissionFixture();
    const root = await temporaryDirectory('hypequery-store-');
    const store = createFileSystemDeploymentSubmissionStore<string>({ directory: root });

    await expect(store.accept(fixture.submission)).resolves.toBe('accepted');
    await rm(fixture.source, { force: true, recursive: true });

    const stored = await store.read(fixture.submission.releaseIdentity);
    expect(stored?.release).toEqual(fixture.submission.release);
    expect(stored?.bundle.identity).toBe(fixture.submission.bundle.identity);
    expect(await readFile(path.join(
      stored!.bundle.directory,
      ...fixture.deploymentPath.split('/'),
    ), 'utf8')).toBe(`${prepareProtocolDeploymentContract(stored!.bundle.contract).canonical}\n`);
    expect(await readdir(root)).toEqual(['bundles', 'releases']);
    expect(await readdir(path.join(root, 'releases', fixture.submission.releaseIdentity)))
      .toEqual(['release.json']);
    expect(await readFile(path.join(
      root,
      'releases',
      fixture.submission.releaseIdentity,
      'release.json',
    ), 'utf8')).toBe(fixture.submission.releaseCanonical);
  });

  it('returns already-exists without rereading an already-stored source bundle', async () => {
    const fixture = await submissionFixture();
    const root = await temporaryDirectory('hypequery-store-');
    const store = createFileSystemDeploymentSubmissionStore<string>({ directory: root });
    await store.accept(fixture.submission);
    await rm(fixture.source, { force: true, recursive: true });

    await expect(store.accept(fixture.submission)).resolves.toBe('already-exists');
  });

  it('serializes concurrent idempotent submissions through atomic publication', async () => {
    const fixture = await submissionFixture();
    const root = await temporaryDirectory('hypequery-store-');
    const store = createFileSystemDeploymentSubmissionStore<string>({ directory: root });

    const statuses = await Promise.all([
      store.accept(fixture.submission),
      store.accept(fixture.submission),
    ]);

    expect(statuses.sort()).toEqual(['accepted', 'already-exists']);
    await expect(store.read(fixture.submission.releaseIdentity)).resolves.toBeDefined();
  });

  it('returns undefined for a well-formed identity that is not stored', async () => {
    const root = await temporaryDirectory('hypequery-store-');
    const store = createFileSystemDeploymentSubmissionStore({ directory: root });

    await expect(store.read('0'.repeat(64))).resolves.toBeUndefined();
  });

  it.skipIf(process.platform === 'win32')(
    'initializes and syncs the store layout only once',
    async () => {
      const root = await temporaryDirectory('hypequery-store-');
      const probe = await open(root, 'r');
      const prototype = Object.getPrototypeOf(probe) as FileHandle;
      await probe.close();
      const sync = vi.spyOn(prototype, 'sync');
      const store = createFileSystemDeploymentSubmissionStore({ directory: root });

      try {
        await store.read('0'.repeat(64));
        const initializationSyncs = sync.mock.calls.length;
        expect(initializationSyncs).toBeGreaterThan(0);

        await store.read('1'.repeat(64));
        expect(sync).toHaveBeenCalledTimes(initializationSyncs);
      } finally {
        sync.mockRestore();
      }
    },
  );

  it('rejects inconsistent submission metadata before writing store state', async () => {
    const fixture = await submissionFixture();
    const root = await temporaryDirectory('hypequery-store-');
    const store = createFileSystemDeploymentSubmissionStore<string>({ directory: root });
    const submission = {
      ...fixture.submission,
      releaseIdentity: '0'.repeat(64),
    };

    await expectStoreCode(
      store.accept(submission),
      'HQ_DEPLOYMENT_STORE_INVALID_SUBMISSION',
    );
    expect(await readdir(root)).toEqual([]);
  });

  it('rejects and cleans staging when a verified source changes before persistence', async () => {
    const fixture = await submissionFixture();
    const root = await temporaryDirectory('hypequery-store-');
    const store = createFileSystemDeploymentSubmissionStore<string>({ directory: root });
    const deploymentFile = path.join(fixture.source, fixture.deploymentPath);
    const bytes = await readFile(deploymentFile);
    bytes[0] = bytes[0]! ^ 1;
    await writeFile(deploymentFile, bytes);

    await expectStoreCode(
      store.accept(fixture.submission),
      'HQ_DEPLOYMENT_STORE_INVALID_SUBMISSION',
    );
    expect((await readdir(root)).filter(name => name.includes('staging'))).toEqual([]);
    await expect(store.read(fixture.submission.releaseIdentity)).resolves.toBeUndefined();
  });

  it.skipIf(process.platform === 'win32')(
    'does not follow a source entry replaced with a symbolic link',
    async () => {
      const fixture = await submissionFixture();
      const root = await temporaryDirectory('hypequery-store-');
      const store = createFileSystemDeploymentSubmissionStore<string>({ directory: root });
      const deploymentFile = path.join(fixture.source, fixture.deploymentPath);
      const external = path.join(await temporaryDirectory('hypequery-store-external-'), 'data');
      await writeFile(external, await readFile(deploymentFile));
      await rm(deploymentFile);
      await symlink(external, deploymentFile);

      await expectStoreCode(
        store.accept(fixture.submission),
        'HQ_DEPLOYMENT_STORE_INVALID_SUBMISSION',
      );
      expect((await readdir(root)).filter(name => name.includes('staging'))).toEqual([]);
    },
  );

  it('detects corrupt stored bundle bytes on reads and replays', async () => {
    const fixture = await submissionFixture();
    const root = await temporaryDirectory('hypequery-store-');
    const store = createFileSystemDeploymentSubmissionStore<string>({ directory: root });
    await store.accept(fixture.submission);
    const storedDeployment = path.join(
      root,
      'bundles',
      fixture.submission.bundle.identity,
      ...fixture.deploymentPath.split('/'),
    );
    await writeFile(storedDeployment, 'corrupt');

    await expectStoreCode(
      store.read(fixture.submission.releaseIdentity),
      'HQ_DEPLOYMENT_STORE_CORRUPT_STATE',
    );
    await expectStoreCode(
      store.accept(fixture.submission),
      'HQ_DEPLOYMENT_STORE_CORRUPT_STATE',
    );
  });

  it('detects undeclared state in an existing release directory', async () => {
    const fixture = await submissionFixture();
    const root = await temporaryDirectory('hypequery-store-');
    const store = createFileSystemDeploymentSubmissionStore<string>({ directory: root });
    await store.accept(fixture.submission);
    await writeFile(path.join(
      root,
      'releases',
      fixture.submission.releaseIdentity,
      'unexpected',
    ), 'data');

    await expectStoreCode(
      store.read(fixture.submission.releaseIdentity),
      'HQ_DEPLOYMENT_STORE_CORRUPT_STATE',
    );
    await expectStoreCode(
      store.accept(fixture.submission),
      'HQ_DEPLOYMENT_STORE_CORRUPT_STATE',
    );
  });

  it('enforces the release byte ceiling if the file grows after stat', async () => {
    const fixture = await submissionFixture();
    const root = await temporaryDirectory('hypequery-store-');
    const store = createFileSystemDeploymentSubmissionStore<string>({ directory: root });
    await store.accept(fixture.submission);
    const releasePath = path.join(
      root,
      'releases',
      fixture.submission.releaseIdentity,
      'release.json',
    );
    const probe = await open(releasePath, 'r');
    const prototype = Object.getPrototypeOf(probe) as FileHandle;
    const originalRead = prototype.read;
    await probe.close();
    const read = vi.spyOn(prototype, 'read').mockImplementationOnce(async function (...args) {
      await appendFile(releasePath, Buffer.alloc(16 * 1024));
      return originalRead.apply(this, args);
    });

    try {
      await expectStoreCode(
        store.read(fixture.submission.releaseIdentity),
        'HQ_DEPLOYMENT_STORE_CORRUPT_STATE',
      );
      expect(read).toHaveBeenCalled();
    } finally {
      read.mockRestore();
    }
  });

  it('recovers a missing release record from an already-published bundle', async () => {
    const fixture = await submissionFixture();
    const root = await temporaryDirectory('hypequery-store-');
    const store = createFileSystemDeploymentSubmissionStore<string>({ directory: root });
    await store.accept(fixture.submission);
    await rm(path.join(root, 'releases', fixture.submission.releaseIdentity), {
      recursive: true,
    });
    await rm(fixture.source, { recursive: true });

    await expect(store.accept(fixture.submission)).resolves.toBe('accepted');
    await expect(store.read(fixture.submission.releaseIdentity)).resolves.toBeDefined();
  });

  it('rejects conflicting reserved store entries as corrupt state', async () => {
    const fixture = await submissionFixture();
    const root = await temporaryDirectory('hypequery-store-');
    await writeFile(path.join(root, 'bundles'), 'not a directory');
    const store = createFileSystemDeploymentSubmissionStore<string>({ directory: root });

    await expectStoreCode(
      store.accept(fixture.submission),
      'HQ_DEPLOYMENT_STORE_CORRUPT_STATE',
    );
  });

  it.skipIf(process.platform === 'win32')(
    'rejects a store root that is a symbolic link',
    async () => {
      const parent = await temporaryDirectory('hypequery-store-parent-');
      const target = await temporaryDirectory('hypequery-store-target-');
      const linkedRoot = path.join(parent, 'store');
      await symlink(target, linkedRoot, 'dir');
      const store = createFileSystemDeploymentSubmissionStore({ directory: linkedRoot });

      await expectStoreCode(
        store.read('0'.repeat(64)),
        'HQ_DEPLOYMENT_STORE_CORRUPT_STATE',
      );
    },
  );

  it('rejects filesystem-root configuration', () => {
    expect(() => createFileSystemDeploymentSubmissionStore({
      directory: path.parse(path.resolve('.')).root,
    })).toThrow(expect.objectContaining({
      code: 'HQ_DEPLOYMENT_STORE_CONFIGURATION',
    }));
  });
});
