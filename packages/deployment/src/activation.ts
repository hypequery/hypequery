import { createHash } from 'node:crypto';
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
  validateProtocolDeploymentReleaseTarget,
  type ProtocolDeploymentReleaseEnvelope,
  type ProtocolDeploymentReleaseTarget,
} from '@hypequery/protocol';

const ACTIVATION_FILE = 'activation.json';
const CLAIMS_DIRECTORY = 'claims';
// Each predecessor has one filesystem slot for its successor. Renaming a
// complete record into that slot is the cross-process compare-and-swap.
const INITIAL_CLAIM = 'initial';
const TARGET_FILE = 'target.json';
const MAX_ACTIVATION_BYTES = 4096;
const MAX_TARGET_BYTES = 1024;
const IDENTITY_PATTERN = /^[0-9a-f]{64}$/;
const ACTIVATION_IDENTITY_DOMAIN = 'hypequery:deployment-activation:v1\0';
const TARGET_IDENTITY_DOMAIN = 'hypequery:deployment-target:v1\0';
const textDecoder = new TextDecoder('utf-8', { fatal: true });

export type DeploymentActivationErrorCode =
  | 'HQ_DEPLOYMENT_ACTIVATION_CONFIGURATION'
  | 'HQ_DEPLOYMENT_ACTIVATION_INVALID_REQUEST'
  | 'HQ_DEPLOYMENT_ACTIVATION_RELEASE_NOT_FOUND'
  | 'HQ_DEPLOYMENT_ACTIVATION_RELEASE_UNAVAILABLE'
  | 'HQ_DEPLOYMENT_ACTIVATION_TARGET_MISMATCH'
  | 'HQ_DEPLOYMENT_ACTIVATION_CORRUPT_STATE'
  | 'HQ_DEPLOYMENT_ACTIVATION_IO';

export class DeploymentActivationError extends Error {
  readonly code: DeploymentActivationErrorCode;

  constructor(
    code: DeploymentActivationErrorCode,
    message: string,
    options: { readonly cause?: unknown } = {},
  ) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause });
    this.name = 'DeploymentActivationError';
    this.code = code;
  }
}

export interface DeploymentActivationRecord {
  readonly kind: 'hypequery-deployment-activation';
  readonly version: 1;
  readonly revision: string;
  readonly target: ProtocolDeploymentReleaseTarget;
  readonly releaseIdentity: string;
  readonly previousRevision: string | null;
  readonly previousReleaseIdentity: string | null;
  readonly activatedAt: string;
}

export interface DeploymentActivationRequest {
  readonly target: ProtocolDeploymentReleaseTarget;
  readonly releaseIdentity: string;
  /** `null` means the caller expects this target to have no active release. */
  readonly expectedRevision: string | null;
}

export type DeploymentActivationResult =
  | {
    readonly status: 'activated' | 'already-active';
    readonly activation: DeploymentActivationRecord;
  }
  | {
    readonly status: 'conflict';
    readonly current: DeploymentActivationRecord | null;
  };

export interface DeploymentActivationRelease {
  readonly release: ProtocolDeploymentReleaseEnvelope;
  readonly releaseIdentity: string;
}

export interface DeploymentReleaseReader {
  /** Return only accepted releases whose release and closed bundle remain completely valid. */
  read(releaseIdentity: string): Promise<DeploymentActivationRelease | undefined>;
}

export interface FileSystemDeploymentActivationRegistryOptions {
  readonly directory: string;
  readonly releases: DeploymentReleaseReader;
  readonly clock?: () => Date;
}

export interface DeploymentActivationRegistry {
  activate(request: DeploymentActivationRequest): Promise<DeploymentActivationResult>;
  current(
    target: ProtocolDeploymentReleaseTarget,
  ): Promise<DeploymentActivationRecord | undefined>;
  history(
    target: ProtocolDeploymentReleaseTarget,
  ): Promise<readonly DeploymentActivationRecord[]>;
}

interface PreparedActivation {
  readonly record: DeploymentActivationRecord;
  readonly canonical: string;
  readonly bytes: Uint8Array;
}

function activationError(
  code: DeploymentActivationErrorCode,
  message: string,
  cause?: unknown,
): DeploymentActivationError {
  return new DeploymentActivationError(code, message, { cause });
}

function errorCode(error: unknown): string | undefined {
  return typeof error === 'object' && error !== null && 'code' in error
    ? String((error as { code?: unknown }).code)
    : undefined;
}

function isOperationalFileSystemError(error: unknown): boolean {
  const code = errorCode(error);
  return code !== undefined && !['EISDIR', 'ELOOP', 'ENOENT', 'ENOTDIR'].includes(code);
}

function sha256(domain: string, value: string): string {
  return createHash('sha256').update(domain).update(value).digest('hex');
}

function targetCanonical(target: ProtocolDeploymentReleaseTarget): string {
  return JSON.stringify({ project: target.project, environment: target.environment });
}

function targetsEqual(
  left: ProtocolDeploymentReleaseTarget,
  right: ProtocolDeploymentReleaseTarget,
): boolean {
  return left.project === right.project && left.environment === right.environment;
}

function validateTarget(
  input: unknown,
  code: DeploymentActivationErrorCode,
): ProtocolDeploymentReleaseTarget {
  try {
    return validateProtocolDeploymentReleaseTarget(input);
  } catch (error) {
    throw activationError(code, 'Deployment activation target is invalid.', error);
  }
}

function requireIdentity(
  input: unknown,
  description: string,
  code: DeploymentActivationErrorCode,
): string {
  if (typeof input !== 'string' || !IDENTITY_PATTERN.test(input)) {
    throw activationError(code, `${description} must be 64 lowercase hexadecimal characters.`);
  }
  return input;
}

function requireNullableIdentity(
  input: unknown,
  description: string,
  code: DeploymentActivationErrorCode,
): string | null {
  return input === null ? null : requireIdentity(input, description, code);
}

function activationPayloadCanonical(input: {
  readonly target: ProtocolDeploymentReleaseTarget;
  readonly releaseIdentity: string;
  readonly previousRevision: string | null;
  readonly previousReleaseIdentity: string | null;
  readonly activatedAt: string;
}): string {
  // Every value has already been reduced to a closed primitive shape, so this
  // fixed construction order is also the canonical byte order persisted below.
  return JSON.stringify({
    kind: 'hypequery-deployment-activation',
    version: 1,
    target: {
      project: input.target.project,
      environment: input.target.environment,
    },
    releaseIdentity: input.releaseIdentity,
    previousRevision: input.previousRevision,
    previousReleaseIdentity: input.previousReleaseIdentity,
    activatedAt: input.activatedAt,
  });
}

function activationCanonical(record: DeploymentActivationRecord): string {
  return JSON.stringify({
    kind: record.kind,
    version: record.version,
    revision: record.revision,
    target: {
      project: record.target.project,
      environment: record.target.environment,
    },
    releaseIdentity: record.releaseIdentity,
    previousRevision: record.previousRevision,
    previousReleaseIdentity: record.previousReleaseIdentity,
    activatedAt: record.activatedAt,
  });
}

function prepareActivation(input: {
  readonly target: ProtocolDeploymentReleaseTarget;
  readonly releaseIdentity: string;
  readonly previousRevision: string | null;
  readonly previousReleaseIdentity: string | null;
  readonly activatedAt: string;
}): PreparedActivation {
  const payload = activationPayloadCanonical(input);
  const revision = sha256(ACTIVATION_IDENTITY_DOMAIN, payload);
  const record: DeploymentActivationRecord = Object.freeze({
    kind: 'hypequery-deployment-activation',
    version: 1,
    revision,
    target: input.target,
    releaseIdentity: input.releaseIdentity,
    previousRevision: input.previousRevision,
    previousReleaseIdentity: input.previousReleaseIdentity,
    activatedAt: input.activatedAt,
  });
  const canonical = activationCanonical(record);
  return Object.freeze({ record, canonical, bytes: Buffer.from(canonical) });
}

function requireRecord(input: unknown): Record<string, unknown> {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) {
    throw new Error('Activation record must be an object.');
  }
  const value = input as Record<string, unknown>;
  const expected = [
    'activatedAt',
    'kind',
    'previousReleaseIdentity',
    'previousRevision',
    'releaseIdentity',
    'revision',
    'target',
    'version',
  ];
  if (Object.keys(value).sort().join('\0') !== expected.join('\0')) {
    throw new Error('Activation record fields are inconsistent.');
  }
  return value;
}

function validateStoredActivation(
  input: unknown,
  expectedTarget: ProtocolDeploymentReleaseTarget,
  expectedPreviousRevision: string | null,
  expectedPreviousReleaseIdentity: string | null,
): PreparedActivation {
  const value = requireRecord(input);
  if (value.kind !== 'hypequery-deployment-activation' || value.version !== 1) {
    throw new Error('Activation record kind or version is invalid.');
  }
  const target = validateTarget(value.target, 'HQ_DEPLOYMENT_ACTIVATION_CORRUPT_STATE');
  if (!targetsEqual(target, expectedTarget)) {
    throw new Error('Activation record target is inconsistent.');
  }
  const releaseIdentity = requireIdentity(
    value.releaseIdentity,
    'Stored release identity',
    'HQ_DEPLOYMENT_ACTIVATION_CORRUPT_STATE',
  );
  const previousRevision = requireNullableIdentity(
    value.previousRevision,
    'Stored previous revision',
    'HQ_DEPLOYMENT_ACTIVATION_CORRUPT_STATE',
  );
  const previousReleaseIdentity = requireNullableIdentity(
    value.previousReleaseIdentity,
    'Stored previous release identity',
    'HQ_DEPLOYMENT_ACTIVATION_CORRUPT_STATE',
  );
  if (previousRevision !== expectedPreviousRevision
    || previousReleaseIdentity !== expectedPreviousReleaseIdentity
    || (previousRevision === null) !== (previousReleaseIdentity === null)) {
    throw new Error('Activation record predecessor is inconsistent.');
  }
  if (typeof value.activatedAt !== 'string') {
    throw new Error('Activation timestamp is invalid.');
  }
  const timestamp = new Date(value.activatedAt);
  if (!Number.isFinite(timestamp.valueOf()) || timestamp.toISOString() !== value.activatedAt) {
    throw new Error('Activation timestamp is not a canonical ISO timestamp.');
  }
  const prepared = prepareActivation({
    target,
    releaseIdentity,
    previousRevision,
    previousReleaseIdentity,
    activatedAt: value.activatedAt,
  });
  if (value.revision !== prepared.record.revision) {
    throw new Error('Activation revision does not match its contents.');
  }
  return prepared;
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

async function requireRegularDirectory(directory: string, description: string): Promise<void> {
  const stat = await lstat(directory);
  if (stat.isSymbolicLink() || !stat.isDirectory()) {
    throw activationError(
      'HQ_DEPLOYMENT_ACTIVATION_CORRUPT_STATE',
      `${description} must be a regular directory: ${directory}`,
    );
  }
}

async function ensureRegularDirectory(
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

async function syncDirectory(directory: string): Promise<void> {
  if (process.platform === 'win32') return;
  const handle = await open(directory, constants.O_RDONLY);
  try {
    await handle.sync();
  } finally {
    await handle.close();
  }
}

async function writeExclusiveFile(filePath: string, bytes: Uint8Array): Promise<void> {
  const handle = await open(filePath, 'wx', 0o600);
  try {
    let offset = 0;
    while (offset < bytes.byteLength) {
      const result = await handle.write(bytes, offset, bytes.byteLength - offset);
      if (result.bytesWritten < 1) throw new Error('Filesystem write made no progress.');
      offset += result.bytesWritten;
    }
    await handle.sync();
  } finally {
    await handle.close();
  }
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
    return await handle.readFile();
  } finally {
    await handle.close();
  }
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
    throw activationError(
      'HQ_DEPLOYMENT_ACTIVATION_IO',
      `Could not clean deployment activation staging directory: ${staging}`,
      failure ? new AggregateError([failure.error, error]) : error,
    );
  }
  if (failure) throw failure.error;
  return result as T;
}

async function readCanonicalTarget(
  targetDirectory: string,
  expectedTarget: ProtocolDeploymentReleaseTarget,
): Promise<void> {
  try {
    await requireRegularDirectory(targetDirectory, 'Deployment activation target');
    const entries = (await readdir(targetDirectory)).sort();
    if (entries.join('\0') !== `${CLAIMS_DIRECTORY}\0${TARGET_FILE}`) {
      throw new Error('Deployment activation target contains undeclared or missing entries.');
    }
    await requireRegularDirectory(
      path.join(targetDirectory, CLAIMS_DIRECTORY),
      'Deployment activation claims',
    );
    const bytes = await readRegularFile(path.join(targetDirectory, TARGET_FILE), MAX_TARGET_BYTES);
    let input: unknown;
    try {
      input = JSON.parse(textDecoder.decode(bytes));
    } catch (error) {
      throw new Error('Stored deployment activation target is invalid JSON.', { cause: error });
    }
    const target = validateTarget(input, 'HQ_DEPLOYMENT_ACTIVATION_CORRUPT_STATE');
    if (!targetsEqual(target, expectedTarget)
      || !Buffer.from(bytes).equals(Buffer.from(targetCanonical(target)))) {
      throw new Error('Stored deployment activation target is inconsistent.');
    }
  } catch (error) {
    if (error instanceof DeploymentActivationError) throw error;
    if (isOperationalFileSystemError(error)) throw error;
    throw activationError(
      'HQ_DEPLOYMENT_ACTIVATION_CORRUPT_STATE',
      'Stored deployment activation target is invalid.',
      error,
    );
  }
}

async function ensureTargetDirectory(
  activationsRoot: string,
  target: ProtocolDeploymentReleaseTarget,
): Promise<string> {
  const canonical = targetCanonical(target);
  const targetKey = sha256(TARGET_IDENTITY_DOMAIN, canonical);
  const destination = path.join(activationsRoot, targetKey);
  if (await pathExists(destination)) {
    await readCanonicalTarget(destination, target);
    return destination;
  }
  await withStagingDirectory(activationsRoot, '.target-staging-', async staging => {
    await mkdir(path.join(staging, CLAIMS_DIRECTORY), { mode: 0o700 });
    await writeExclusiveFile(path.join(staging, TARGET_FILE), Buffer.from(canonical));
    await syncDirectory(path.join(staging, CLAIMS_DIRECTORY));
    await syncDirectory(staging);
    try {
      await rename(staging, destination);
    } catch (error) {
      if (!await pathExists(destination)) throw error;
      await readCanonicalTarget(destination, target);
      return;
    }
    await syncDirectory(activationsRoot);
  });
  await readCanonicalTarget(destination, target);
  return destination;
}

async function readStoredActivation(
  claimDirectory: string,
  target: ProtocolDeploymentReleaseTarget,
  previousRevision: string | null,
  previousReleaseIdentity: string | null,
): Promise<PreparedActivation> {
  await requireRegularDirectory(claimDirectory, 'Deployment activation claim');
  const entries = await readdir(claimDirectory);
  if (entries.length !== 1 || entries[0] !== ACTIVATION_FILE) {
    throw new Error('Deployment activation claim contains undeclared or missing entries.');
  }
  const bytes = await readRegularFile(
    path.join(claimDirectory, ACTIVATION_FILE),
    MAX_ACTIVATION_BYTES,
  );
  let input: unknown;
  try {
    input = JSON.parse(textDecoder.decode(bytes));
  } catch (error) {
    throw new Error('Stored deployment activation is invalid JSON.', { cause: error });
  }
  const prepared = validateStoredActivation(
    input,
    target,
    previousRevision,
    previousReleaseIdentity,
  );
  if (!Buffer.from(bytes).equals(Buffer.from(prepared.bytes))) {
    throw new Error('Stored deployment activation is not canonical JSON.');
  }
  return prepared;
}

async function resolveHistory(
  targetDirectory: string,
  target: ProtocolDeploymentReleaseTarget,
): Promise<readonly DeploymentActivationRecord[]> {
  try {
    await readCanonicalTarget(targetDirectory, target);
    const claimsDirectory = path.join(targetDirectory, CLAIMS_DIRECTORY);
    const claimNames = (await readdir(claimsDirectory)).sort();
    for (const name of claimNames) {
      if (name !== INITIAL_CLAIM && !IDENTITY_PATTERN.test(name)) {
        throw new Error(`Deployment activation claim name is invalid: ${name}`);
      }
    }
    const remaining = new Set(claimNames);
    const revisions = new Set<string>();
    const history: DeploymentActivationRecord[] = [];
    let previousRevision: string | null = null;
    let previousReleaseIdentity: string | null = null;
    // Following predecessor-named claims derives the head without trusting a
    // mutable pointer. The remaining-set check rejects orphaned branches.
    for (;;) {
      const claimName = previousRevision ?? INITIAL_CLAIM;
      if (!remaining.delete(claimName)) break;
      const prepared = await readStoredActivation(
        path.join(claimsDirectory, claimName),
        target,
        previousRevision,
        previousReleaseIdentity,
      );
      if (revisions.has(prepared.record.revision)) {
        throw new Error('Deployment activation history contains a cycle.');
      }
      revisions.add(prepared.record.revision);
      history.push(prepared.record);
      previousRevision = prepared.record.revision;
      previousReleaseIdentity = prepared.record.releaseIdentity;
    }
    if (remaining.size > 0) {
      throw new Error('Deployment activation history contains unreachable claims.');
    }
    return Object.freeze(history);
  } catch (error) {
    if (error instanceof DeploymentActivationError) throw error;
    if (isOperationalFileSystemError(error)) throw error;
    throw activationError(
      'HQ_DEPLOYMENT_ACTIVATION_CORRUPT_STATE',
      'Stored deployment activation history is invalid.',
      error,
    );
  }
}

function currentActivation(
  history: readonly DeploymentActivationRecord[],
): DeploymentActivationRecord | undefined {
  return history[history.length - 1];
}

export function createFileSystemDeploymentActivationRegistry(
  options: FileSystemDeploymentActivationRegistryOptions,
): DeploymentActivationRegistry {
  if (typeof options.directory !== 'string' || options.directory.length < 1) {
    throw activationError(
      'HQ_DEPLOYMENT_ACTIVATION_CONFIGURATION',
      'Deployment activation directory is required.',
    );
  }
  if (typeof options.releases?.read !== 'function') {
    throw activationError(
      'HQ_DEPLOYMENT_ACTIVATION_CONFIGURATION',
      'A deployment release reader is required.',
    );
  }
  const root = path.resolve(options.directory);
  if (root === path.parse(root).root) {
    throw activationError(
      'HQ_DEPLOYMENT_ACTIVATION_CONFIGURATION',
      'Deployment activation directory cannot be a filesystem root.',
    );
  }
  const clock = options.clock ?? (() => new Date());
  const activations = path.join(root, 'activations');
  let initializationPromise: Promise<void> | undefined;

  async function initializeActivationRoot(): Promise<void> {
    const rootCreated = await ensureRegularDirectory(root, 'Deployment store root');
    const activationsCreated = await ensureRegularDirectory(
      activations,
      'Deployment activation store',
    );
    if (activationsCreated) await syncDirectory(root);
    if (rootCreated) await syncDirectory(path.dirname(root));
  }

  async function activationRoot(): Promise<string> {
    const pending = initializationPromise ??= initializeActivationRoot();
    try {
      await pending;
    } catch (error) {
      if (initializationPromise === pending) initializationPromise = undefined;
      throw error;
    }
    await requireRegularDirectory(root, 'Deployment store root');
    await requireRegularDirectory(activations, 'Deployment activation store');
    return activations;
  }

  async function history(
    targetInput: ProtocolDeploymentReleaseTarget,
  ): Promise<readonly DeploymentActivationRecord[]> {
    const target = validateTarget(targetInput, 'HQ_DEPLOYMENT_ACTIVATION_INVALID_REQUEST');
    try {
      const activations = await activationRoot();
      const key = sha256(TARGET_IDENTITY_DOMAIN, targetCanonical(target));
      const targetDirectory = path.join(activations, key);
      if (!await pathExists(targetDirectory)) return Object.freeze([]);
      return await resolveHistory(targetDirectory, target);
    } catch (error) {
      if (error instanceof DeploymentActivationError) throw error;
      throw activationError(
        'HQ_DEPLOYMENT_ACTIVATION_IO',
        'Could not read deployment activation history.',
        error,
      );
    }
  }

  async function current(
    target: ProtocolDeploymentReleaseTarget,
  ): Promise<DeploymentActivationRecord | undefined> {
    return currentActivation(await history(target));
  }

  async function activate(
    request: DeploymentActivationRequest,
  ): Promise<DeploymentActivationResult> {
    const target = validateTarget(request.target, 'HQ_DEPLOYMENT_ACTIVATION_INVALID_REQUEST');
    const releaseIdentity = requireIdentity(
      request.releaseIdentity,
      'Deployment release identity',
      'HQ_DEPLOYMENT_ACTIVATION_INVALID_REQUEST',
    );
    const expectedRevision = requireNullableIdentity(
      request.expectedRevision,
      'Expected deployment activation revision',
      'HQ_DEPLOYMENT_ACTIVATION_INVALID_REQUEST',
    );
    let storedRelease: DeploymentActivationRelease | undefined;
    try {
      storedRelease = await options.releases.read(releaseIdentity);
    } catch (error) {
      throw activationError(
        'HQ_DEPLOYMENT_ACTIVATION_RELEASE_UNAVAILABLE',
        `Could not verify deployment release before activation: ${releaseIdentity}`,
        error,
      );
    }
    if (!storedRelease) {
      throw activationError(
        'HQ_DEPLOYMENT_ACTIVATION_RELEASE_NOT_FOUND',
        `Deployment release is not stored: ${releaseIdentity}`,
      );
    }
    let verifiedRelease;
    try {
      verifiedRelease = prepareProtocolDeploymentReleaseEnvelope(storedRelease.release);
    } catch (error) {
      throw activationError(
        'HQ_DEPLOYMENT_ACTIVATION_RELEASE_UNAVAILABLE',
        `Stored deployment release is invalid: ${releaseIdentity}`,
        error,
      );
    }
    if (storedRelease.releaseIdentity !== releaseIdentity
      || verifiedRelease.identity !== releaseIdentity) {
      throw activationError(
        'HQ_DEPLOYMENT_ACTIVATION_RELEASE_UNAVAILABLE',
        `Stored deployment release identity is inconsistent: ${releaseIdentity}`,
      );
    }
    if (!targetsEqual(verifiedRelease.release.target, target)) {
      throw activationError(
        'HQ_DEPLOYMENT_ACTIVATION_TARGET_MISMATCH',
        'Deployment release target does not match the activation target.',
      );
    }

    try {
      const activations = await activationRoot();
      const targetDirectory = await ensureTargetDirectory(activations, target);
      const existingHistory = await resolveHistory(targetDirectory, target);
      const existing = currentActivation(existingHistory);
      if (existing?.releaseIdentity === releaseIdentity) {
        return Object.freeze({ status: 'already-active', activation: existing });
      }
      if ((existing?.revision ?? null) !== expectedRevision) {
        return Object.freeze({ status: 'conflict', current: existing ?? null });
      }

      let now: Date;
      try {
        now = clock();
        if (!(now instanceof Date) || !Number.isFinite(now.valueOf())) throw new Error('Invalid date.');
      } catch (error) {
        throw activationError(
          'HQ_DEPLOYMENT_ACTIVATION_CONFIGURATION',
          'Deployment activation clock returned an invalid value.',
          error,
        );
      }
      const prepared = prepareActivation({
        target,
        releaseIdentity,
        previousRevision: existing?.revision ?? null,
        previousReleaseIdentity: existing?.releaseIdentity ?? null,
        activatedAt: now.toISOString(),
      });
      const claimsDirectory = path.join(targetDirectory, CLAIMS_DIRECTORY);
      const claimName = existing?.revision ?? INITIAL_CLAIM;
      const destination = path.join(claimsDirectory, claimName);
      const published = await withStagingDirectory(
        // Staging lives outside the exact target directory, so interrupted
        // writers are invisible to history readers until the atomic rename.
        activations,
        '.activation-staging-',
        async staging => {
          await writeExclusiveFile(path.join(staging, ACTIVATION_FILE), prepared.bytes);
          await syncDirectory(staging);
          try {
            await rename(staging, destination);
          } catch (error) {
            if (!await pathExists(destination)) throw error;
            return false;
          }
          await syncDirectory(claimsDirectory);
          return true;
        },
      );
      if (published) {
        return Object.freeze({ status: 'activated', activation: prepared.record });
      }
      const resolved = currentActivation(await resolveHistory(targetDirectory, target));
      if (resolved?.releaseIdentity === releaseIdentity) {
        return Object.freeze({ status: 'already-active', activation: resolved });
      }
      return Object.freeze({ status: 'conflict', current: resolved ?? null });
    } catch (error) {
      if (error instanceof DeploymentActivationError) throw error;
      throw activationError(
        'HQ_DEPLOYMENT_ACTIVATION_IO',
        'Could not update deployment activation state.',
        error,
      );
    }
  }

  return Object.freeze({ activate, current, history });
}
