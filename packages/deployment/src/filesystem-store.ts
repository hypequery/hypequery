import { constants } from 'node:fs';
import {
  lstat,
  mkdir,
  mkdtemp,
  open,
  readdir,
  rename,
  rm,
} from 'node:fs/promises';
import path from 'node:path';
import {
  prepareProtocolDeploymentReleaseEnvelope,
  type ProtocolDeploymentReleaseEnvelope,
} from '@hypequery/protocol';
import {
  DEPLOYMENT_BUNDLE_MANIFEST,
  verifyDeploymentBundle,
  type VerifiedDeploymentBundle,
} from './bundle.js';
import type {
  DeploymentSubmissionStore,
  VerifiedDeploymentSubmission,
} from './types.js';

const RELEASE_FILE = 'release.json';
const MAX_MANIFEST_BYTES = 1024 * 1024;
const MAX_RELEASE_BYTES = 16 * 1024;
const COPY_BUFFER_BYTES = 64 * 1024;
const IDENTITY_PATTERN = /^[0-9a-f]{64}$/;
const textDecoder = new TextDecoder('utf-8', { fatal: true });

export type FileSystemDeploymentStoreErrorCode =
  | 'HQ_DEPLOYMENT_STORE_CONFIGURATION'
  | 'HQ_DEPLOYMENT_STORE_INVALID_SUBMISSION'
  | 'HQ_DEPLOYMENT_STORE_CORRUPT_STATE'
  | 'HQ_DEPLOYMENT_STORE_IO';

export class FileSystemDeploymentStoreError extends Error {
  readonly code: FileSystemDeploymentStoreErrorCode;

  constructor(
    code: FileSystemDeploymentStoreErrorCode,
    message: string,
    options: { readonly cause?: unknown } = {},
  ) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause });
    this.name = 'FileSystemDeploymentStoreError';
    this.code = code;
  }
}

export interface FileSystemDeploymentSubmissionStoreOptions {
  readonly directory: string;
}

export interface StoredDeploymentSubmission {
  readonly releaseDirectory: string;
  readonly release: ProtocolDeploymentReleaseEnvelope;
  readonly releaseCanonical: string;
  readonly releaseIdentity: string;
  readonly bundle: VerifiedDeploymentBundle;
}

export interface FileSystemDeploymentSubmissionStore<Principal>
  extends DeploymentSubmissionStore<Principal> {
  read(releaseIdentity: string): Promise<StoredDeploymentSubmission | undefined>;
}

function storeError(
  code: FileSystemDeploymentStoreErrorCode,
  message: string,
  cause?: unknown,
): FileSystemDeploymentStoreError {
  return new FileSystemDeploymentStoreError(code, message, { cause });
}

function errorCode(error: unknown): string | undefined {
  return typeof error === 'object' && error !== null && 'code' in error
    ? String((error as { code?: unknown }).code)
    : undefined;
}

async function pathExists(filePath: string): Promise<boolean> {
  try {
    await lstat(filePath);
    return true;
  } catch (error) {
    if (errorCode(error) === 'ENOENT') return false;
    throw error;
  }
}

async function requireRegularDirectory(
  directory: string,
  description: string,
  code: FileSystemDeploymentStoreErrorCode = 'HQ_DEPLOYMENT_STORE_CORRUPT_STATE',
): Promise<void> {
  const stat = await lstat(directory);
  if (stat.isSymbolicLink() || !stat.isDirectory()) {
    throw storeError(
      code,
      `${description} must be a regular directory: ${directory}`,
    );
  }
}

async function ensureRegularStoreDirectory(
  directory: string,
  description: string,
): Promise<boolean> {
  let created = false;
  try {
    created = await mkdir(directory, { recursive: true, mode: 0o700 }) !== undefined;
  } catch (error) {
    if (errorCode(error) !== 'EEXIST') throw error;
  }
  await requireRegularDirectory(directory, description);
  return created;
}

async function ensureStoreDirectories(root: string): Promise<{
  readonly bundles: string;
  readonly releases: string;
}> {
  const rootCreated = await ensureRegularStoreDirectory(root, 'Deployment store root');
  const bundles = path.join(root, 'bundles');
  const releases = path.join(root, 'releases');
  const bundlesCreated = await ensureRegularStoreDirectory(bundles, 'Deployment bundle store');
  const releasesCreated = await ensureRegularStoreDirectory(releases, 'Deployment release store');
  if (bundlesCreated || releasesCreated) await syncDirectory(root);
  if (rootCreated) await syncDirectory(path.dirname(root));
  return Object.freeze({ bundles, releases });
}

async function syncDirectory(directory: string): Promise<void> {
  if (process.platform === 'win32') return;
  const handle = await open(directory, constants.O_RDONLY);
  try {
    await handle.sync();
  } finally {
    await handle.close();
  }
}

async function writeAll(
  handle: Awaited<ReturnType<typeof open>>,
  bytes: Uint8Array,
): Promise<void> {
  let offset = 0;
  while (offset < bytes.byteLength) {
    const result = await handle.write(bytes, offset, bytes.byteLength - offset);
    if (result.bytesWritten < 1) throw new Error('Filesystem write made no progress.');
    offset += result.bytesWritten;
  }
}

async function writeExclusiveFile(filePath: string, bytes: Uint8Array): Promise<void> {
  const handle = await open(filePath, 'wx', 0o600);
  try {
    await writeAll(handle, bytes);
    await handle.sync();
  } finally {
    await handle.close();
  }
}

async function copyRegularFile(
  sourcePath: string,
  destinationPath: string,
  maximumBytes: number,
  expectedBytes?: number,
): Promise<void> {
  const initial = await lstat(sourcePath);
  if (initial.isSymbolicLink() || !initial.isFile()) {
    throw storeError(
      'HQ_DEPLOYMENT_STORE_INVALID_SUBMISSION',
      `Verified bundle entry is no longer a regular file: ${sourcePath}`,
    );
  }
  if (initial.size < 1 || initial.size > maximumBytes
    || (expectedBytes !== undefined && initial.size !== expectedBytes)) {
    throw storeError(
      'HQ_DEPLOYMENT_STORE_INVALID_SUBMISSION',
      `Verified bundle entry changed before persistence: ${sourcePath}`,
    );
  }

  let source;
  let destination;
  try {
    source = await open(sourcePath, constants.O_RDONLY | constants.O_NOFOLLOW);
    const stat = await source.stat();
    if (!stat.isFile() || stat.size < 1 || stat.size > maximumBytes
      || (expectedBytes !== undefined && stat.size !== expectedBytes)) {
      throw storeError(
        'HQ_DEPLOYMENT_STORE_INVALID_SUBMISSION',
        `Verified bundle entry changed before persistence: ${sourcePath}`,
      );
    }
    destination = await open(destinationPath, 'wx', 0o600);
    const buffer = Buffer.allocUnsafe(COPY_BUFFER_BYTES);
    let total = 0;
    for (;;) {
      const { bytesRead } = await source.read(buffer, 0, buffer.byteLength, null);
      if (bytesRead === 0) break;
      total += bytesRead;
      if (total > maximumBytes || (expectedBytes !== undefined && total > expectedBytes)) {
        throw storeError(
          'HQ_DEPLOYMENT_STORE_INVALID_SUBMISSION',
          `Verified bundle entry changed before persistence: ${sourcePath}`,
        );
      }
      await writeAll(destination, buffer.subarray(0, bytesRead));
    }
    if (expectedBytes !== undefined && total !== expectedBytes) {
      throw storeError(
        'HQ_DEPLOYMENT_STORE_INVALID_SUBMISSION',
        `Verified bundle entry changed before persistence: ${sourcePath}`,
      );
    }
    await destination.sync();
  } catch (error) {
    if (errorCode(error) === 'ELOOP') {
      throw storeError(
        'HQ_DEPLOYMENT_STORE_INVALID_SUBMISSION',
        `Verified bundle entry became a symbolic link: ${sourcePath}`,
        error,
      );
    }
    throw error;
  } finally {
    try {
      await destination?.close();
    } finally {
      await source?.close();
    }
  }
}

function bundleFilePaths(bundle: VerifiedDeploymentBundle): readonly {
  readonly path: string;
  readonly byteLength?: number;
}[] {
  return Object.freeze([
    { path: DEPLOYMENT_BUNDLE_MANIFEST },
    {
      path: bundle.manifest.deployment.path,
      byteLength: bundle.manifest.deployment.byteLength,
    },
    ...bundle.manifest.artifacts.map(artifact => ({
      path: artifact.path,
      byteLength: artifact.byteLength,
    })),
  ]);
}

async function syncBundleDirectories(
  bundleRoot: string,
  files: readonly { readonly path: string }[],
): Promise<void> {
  const directories = new Set<string>([bundleRoot]);
  for (const file of files) {
    const segments = file.path.split('/');
    for (let index = 1; index < segments.length; index += 1) {
      directories.add(path.join(bundleRoot, ...segments.slice(0, index)));
    }
  }
  const ordered = [...directories].sort((left, right) => (
    right.split(path.sep).length - left.split(path.sep).length
  ));
  for (const directory of ordered) await syncDirectory(directory);
}

async function copyBundleToStaging(
  bundle: VerifiedDeploymentBundle,
  staging: string,
): Promise<VerifiedDeploymentBundle> {
  await requireRegularDirectory(
    bundle.directory,
    'Verified deployment bundle',
    'HQ_DEPLOYMENT_STORE_INVALID_SUBMISSION',
  );
  const files = bundleFilePaths(bundle);
  for (const file of files) {
    const destination = path.join(staging, ...file.path.split('/'));
    await mkdir(path.dirname(destination), { recursive: true, mode: 0o700 });
    await copyRegularFile(
      path.join(bundle.directory, ...file.path.split('/')),
      destination,
      file.byteLength ?? MAX_MANIFEST_BYTES,
      file.byteLength,
    );
  }
  await syncBundleDirectories(staging, files);
  let verified: VerifiedDeploymentBundle;
  try {
    verified = await verifyDeploymentBundle(staging);
  } catch (error) {
    throw storeError(
      'HQ_DEPLOYMENT_STORE_INVALID_SUBMISSION',
      'Deployment bundle changed before it could be persisted.',
      error,
    );
  }
  if (verified.identity !== bundle.identity) {
    throw storeError(
      'HQ_DEPLOYMENT_STORE_INVALID_SUBMISSION',
      'Persisted bundle identity does not match the verified submission.',
    );
  }
  return verified;
}

async function readRegularFile(filePath: string, maximumBytes: number): Promise<Uint8Array> {
  const initial = await lstat(filePath);
  if (initial.isSymbolicLink() || !initial.isFile()
    || initial.size < 1 || initial.size > maximumBytes) {
    throw new Error(`Stored entry is not a bounded regular file: ${filePath}`);
  }
  const handle = await open(filePath, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const stat = await handle.stat();
    if (!stat.isFile() || stat.size < 1 || stat.size > maximumBytes) {
      throw new Error(`Stored entry is not a bounded regular file: ${filePath}`);
    }
    const buffer = Buffer.allocUnsafe(Math.min(COPY_BUFFER_BYTES, maximumBytes + 1));
    const chunks: Buffer[] = [];
    let total = 0;
    while (total <= maximumBytes) {
      const remaining = maximumBytes + 1 - total;
      const { bytesRead } = await handle.read(
        buffer,
        0,
        Math.min(buffer.byteLength, remaining),
        null,
      );
      if (bytesRead === 0) break;
      total += bytesRead;
      if (total > maximumBytes) {
        throw new Error(`Stored entry is not a bounded regular file: ${filePath}`);
      }
      chunks.push(Buffer.from(buffer.subarray(0, bytesRead)));
    }
    if (total < 1) {
      throw new Error(`Stored entry is not a bounded regular file: ${filePath}`);
    }
    return Buffer.concat(chunks, total);
  } finally {
    await handle.close();
  }
}

async function readStoredRelease(
  releaseDirectory: string,
  expectedIdentity: string,
): Promise<{
  readonly release: ProtocolDeploymentReleaseEnvelope;
  readonly canonical: string;
}> {
  await requireRegularDirectory(releaseDirectory, 'Stored deployment release');
  const entries = (await readdir(releaseDirectory)).sort();
  if (entries.length !== 1 || entries[0] !== RELEASE_FILE) {
    throw new Error('Stored deployment release contains undeclared or missing entries.');
  }
  const bytes = await readRegularFile(path.join(releaseDirectory, RELEASE_FILE), MAX_RELEASE_BYTES);
  let input: unknown;
  try {
    input = JSON.parse(textDecoder.decode(bytes));
  } catch (error) {
    throw new Error('Stored deployment release is not valid UTF-8 JSON.', { cause: error });
  }
  const prepared = prepareProtocolDeploymentReleaseEnvelope(input);
  if (prepared.identity !== expectedIdentity
    || !Buffer.from(bytes).equals(Buffer.from(prepared.bytes))) {
    throw new Error('Stored deployment release identity or canonical bytes do not match.');
  }
  return Object.freeze({ release: prepared.release, canonical: prepared.canonical });
}

async function verifyStoredBundle(
  bundleDirectory: string,
  expectedIdentity: string,
): Promise<VerifiedDeploymentBundle> {
  let bundle: VerifiedDeploymentBundle;
  try {
    bundle = await verifyDeploymentBundle(bundleDirectory);
  } catch (error) {
    throw storeError(
      'HQ_DEPLOYMENT_STORE_CORRUPT_STATE',
      `Stored deployment bundle is invalid: ${expectedIdentity}`,
      error,
    );
  }
  if (bundle.identity !== expectedIdentity) {
    throw storeError(
      'HQ_DEPLOYMENT_STORE_CORRUPT_STATE',
      `Stored deployment bundle identity is inconsistent: ${expectedIdentity}`,
    );
  }
  return bundle;
}

async function ensureStoredBundle(
  root: string,
  bundlesDirectory: string,
  bundle: VerifiedDeploymentBundle,
): Promise<void> {
  const destination = path.join(bundlesDirectory, bundle.identity);
  if (await pathExists(destination)) {
    await verifyStoredBundle(destination, bundle.identity);
    return;
  }
  await withStagingDirectory(root, '.bundle-staging-', async staging => {
    await copyBundleToStaging(bundle, staging);
    await publishDirectory(
      staging,
      destination,
      bundlesDirectory,
      async () => { await verifyStoredBundle(destination, bundle.identity); },
    );
  });
}

async function publishDirectory(
  staging: string,
  destination: string,
  parent: string,
  verifyExisting: () => Promise<void>,
): Promise<boolean> {
  if (await pathExists(destination)) {
    await verifyExisting();
    return false;
  }
  try {
    await rename(staging, destination);
  } catch (error) {
    if (!await pathExists(destination)) throw error;
    await verifyExisting();
    return false;
  }
  await syncDirectory(parent);
  return true;
}

async function withStagingDirectory<T>(
  root: string,
  prefix: string,
  action: (directory: string) => Promise<T>,
): Promise<T> {
  const staging = await mkdtemp(path.join(root, prefix));
  let result: T | undefined;
  let failure: { readonly error: unknown } | undefined;
  try {
    result = await action(staging);
  } catch (error) {
    failure = { error };
  }
  try {
    await rm(staging, { force: true, recursive: true });
  } catch (error) {
    throw storeError(
      'HQ_DEPLOYMENT_STORE_IO',
      `Could not clean deployment store staging directory: ${staging}`,
      failure ? new AggregateError([failure.error, error]) : error,
    );
  }
  if (failure) throw failure.error;
  return result as T;
}

function prepareSubmission<Principal>(submission: VerifiedDeploymentSubmission<Principal>) {
  let prepared;
  try {
    prepared = prepareProtocolDeploymentReleaseEnvelope(submission.release);
  } catch (error) {
    throw storeError(
      'HQ_DEPLOYMENT_STORE_INVALID_SUBMISSION',
      'Deployment release is invalid.',
      error,
    );
  }
  if (prepared.identity !== submission.releaseIdentity
    || prepared.canonical !== submission.releaseCanonical
    || prepared.release.bundleIdentity !== submission.bundle.identity) {
    throw storeError(
      'HQ_DEPLOYMENT_STORE_INVALID_SUBMISSION',
      'Deployment submission identities or canonical release bytes are inconsistent.',
    );
  }
  return prepared;
}

function requireIdentity(input: string): string {
  if (!IDENTITY_PATTERN.test(input)) {
    throw storeError(
      'HQ_DEPLOYMENT_STORE_INVALID_SUBMISSION',
      'Deployment release identity must be 64 lowercase hexadecimal characters.',
    );
  }
  return input;
}

export function createFileSystemDeploymentSubmissionStore<Principal = unknown>(
  options: FileSystemDeploymentSubmissionStoreOptions,
): FileSystemDeploymentSubmissionStore<Principal> {
  if (typeof options.directory !== 'string' || options.directory.length < 1) {
    throw storeError(
      'HQ_DEPLOYMENT_STORE_CONFIGURATION',
      'Deployment store directory is required.',
    );
  }
  const root = path.resolve(options.directory);
  if (root === path.parse(root).root) {
    throw storeError(
      'HQ_DEPLOYMENT_STORE_CONFIGURATION',
      'Deployment store directory cannot be a filesystem root.',
    );
  }
  let directoriesPromise: ReturnType<typeof ensureStoreDirectories> | undefined;

  async function storeDirectories(): ReturnType<typeof ensureStoreDirectories> {
    const pending = directoriesPromise ??= ensureStoreDirectories(root);
    try {
      return await pending;
    } catch (error) {
      if (directoriesPromise === pending) directoriesPromise = undefined;
      throw error;
    }
  }

  async function read(releaseIdentity: string): Promise<StoredDeploymentSubmission | undefined> {
    const identity = requireIdentity(releaseIdentity);
    let directories;
    try {
      directories = await storeDirectories();
      const releaseDirectory = path.join(directories.releases, identity);
      if (!await pathExists(releaseDirectory)) return undefined;
      let storedRelease;
      try {
        storedRelease = await readStoredRelease(releaseDirectory, identity);
      } catch (error) {
        if (error instanceof FileSystemDeploymentStoreError) throw error;
        throw storeError(
          'HQ_DEPLOYMENT_STORE_CORRUPT_STATE',
          `Stored deployment release is invalid: ${identity}`,
          error,
        );
      }
      const bundle = await verifyStoredBundle(
        path.join(directories.bundles, storedRelease.release.bundleIdentity),
        storedRelease.release.bundleIdentity,
      );
      return Object.freeze({
        releaseDirectory,
        release: storedRelease.release,
        releaseCanonical: storedRelease.canonical,
        releaseIdentity: identity,
        bundle,
      });
    } catch (error) {
      if (error instanceof FileSystemDeploymentStoreError) throw error;
      throw storeError(
        'HQ_DEPLOYMENT_STORE_IO',
        `Could not read deployment release from ${root}.`,
        error,
      );
    }
  }

  async function accept(
    submission: VerifiedDeploymentSubmission<Principal>,
  ): Promise<'accepted' | 'already-exists'> {
    const prepared = prepareSubmission(submission);
    try {
      const directories = await storeDirectories();
      await ensureStoredBundle(root, directories.bundles, submission.bundle);

      const releaseDestination = path.join(directories.releases, submission.releaseIdentity);
      const published = await withStagingDirectory(root, '.release-staging-', async staging => {
        await writeExclusiveFile(path.join(staging, RELEASE_FILE), prepared.bytes);
        await syncDirectory(staging);
        return publishDirectory(
          staging,
          releaseDestination,
          directories.releases,
          async () => {
            let existing;
            try {
              existing = await readStoredRelease(releaseDestination, submission.releaseIdentity);
            } catch (error) {
              throw storeError(
                'HQ_DEPLOYMENT_STORE_CORRUPT_STATE',
                `Stored deployment release is invalid: ${submission.releaseIdentity}`,
                error,
              );
            }
            if (existing.canonical !== prepared.canonical
              || existing.release.bundleIdentity !== submission.bundle.identity) {
              throw storeError(
                'HQ_DEPLOYMENT_STORE_CORRUPT_STATE',
                `Stored deployment release conflicts with its identity: ${submission.releaseIdentity}`,
              );
            }
          },
        );
      });
      return published ? 'accepted' : 'already-exists';
    } catch (error) {
      if (error instanceof FileSystemDeploymentStoreError) throw error;
      throw storeError(
        'HQ_DEPLOYMENT_STORE_IO',
        `Could not persist deployment submission in ${root}.`,
        error,
      );
    }
  }

  return Object.freeze({ accept, read });
}
