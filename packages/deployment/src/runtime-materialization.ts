import { createHash } from 'node:crypto';
import { constants } from 'node:fs';
import { lstat, open } from 'node:fs/promises';
import path from 'node:path';
import type {
  ProtocolDeploymentContract,
  ProtocolDeploymentReleaseEnvelope,
  ProtocolDeploymentReleaseTarget,
} from '@hypequery/protocol';
import { prepareProtocolDeploymentReleaseEnvelope } from '@hypequery/protocol';
import { validateDeploymentActivationRecord } from './activation.js';
import type {
  DeploymentActivationRecord,
  DeploymentActivationRegistry,
} from './activation.js';
import {
  verifyDeploymentBundle,
  type VerifiedDeploymentBundle,
} from './bundle.js';

const DEFAULT_STABILITY_ATTEMPTS = 4;
const MAX_STABILITY_ATTEMPTS = 16;

export type DeploymentRuntimeMaterializationErrorCode =
  | 'HQ_RUNTIME_MATERIALIZATION_CONFIGURATION'
  | 'HQ_RUNTIME_MATERIALIZATION_ACTIVATION_UNAVAILABLE'
  | 'HQ_RUNTIME_MATERIALIZATION_RELEASE_NOT_FOUND'
  | 'HQ_RUNTIME_MATERIALIZATION_RELEASE_INVALID'
  | 'HQ_RUNTIME_MATERIALIZATION_ARTIFACT_INVALID'
  | 'HQ_RUNTIME_MATERIALIZATION_UNSTABLE_ACTIVATION';

export class DeploymentRuntimeMaterializationError extends Error {
  readonly code: DeploymentRuntimeMaterializationErrorCode;

  constructor(
    code: DeploymentRuntimeMaterializationErrorCode,
    message: string,
    options: { readonly cause?: unknown } = {},
  ) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause });
    this.name = 'DeploymentRuntimeMaterializationError';
    this.code = code;
  }
}

export interface DeploymentRuntimeRelease {
  readonly release: ProtocolDeploymentReleaseEnvelope;
  readonly releaseIdentity: string;
  readonly bundle: VerifiedDeploymentBundle;
}

export interface DeploymentRuntimeReleaseReader {
  /** Return only a fully revalidated accepted release and its closed bundle. */
  read(releaseIdentity: string): Promise<DeploymentRuntimeRelease | undefined>;
}

export interface DeploymentRuntimeArtifactSnapshot {
  readonly runtime: 'node' | 'python';
  readonly artifactSha256: string;
  readonly byteLength: number;
  readonly entrypoints: readonly string[];
  /** Returns a fresh copy so callers cannot mutate the materialized bytes. */
  read(): Uint8Array;
}

export interface DeploymentRuntimeQueryBinding {
  readonly query: string;
  readonly runtime: 'node' | 'python';
  readonly artifactSha256: string;
  readonly entrypoint: string;
}

export interface DeploymentRuntimeSnapshot {
  readonly target: ProtocolDeploymentReleaseTarget;
  readonly activation: DeploymentActivationRecord;
  readonly release: ProtocolDeploymentReleaseEnvelope;
  readonly releaseIdentity: string;
  readonly bundleIdentity: string;
  readonly deployment: ProtocolDeploymentContract;
  readonly artifacts: readonly DeploymentRuntimeArtifactSnapshot[];
  readonly queries: readonly DeploymentRuntimeQueryBinding[];
}

export interface DeploymentRuntimeMaterializer {
  /**
   * Materialize the current activation and confirm it remained current while
   * its bytes were copied. Returns undefined when the target has no activation.
   */
  current(target: ProtocolDeploymentReleaseTarget): Promise<DeploymentRuntimeSnapshot | undefined>;
}

export interface DeploymentRuntimeMaterializerOptions {
  readonly activations: DeploymentActivationRegistry;
  readonly releases: DeploymentRuntimeReleaseReader;
  /** Activation-stability attempts from 1 through 16. */
  readonly maxStabilityAttempts?: number;
}

function materializationError(
  code: DeploymentRuntimeMaterializationErrorCode,
  message: string,
  cause?: unknown,
): DeploymentRuntimeMaterializationError {
  return new DeploymentRuntimeMaterializationError(code, message, { cause });
}

function sameTarget(
  left: ProtocolDeploymentReleaseTarget,
  right: ProtocolDeploymentReleaseTarget,
): boolean {
  return left.project === right.project && left.environment === right.environment;
}

function sha256(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

async function readArtifact(
  bundleDirectory: string,
  artifact: { readonly path: string; readonly sha256: string; readonly byteLength: number },
): Promise<Uint8Array> {
  const artifactPath = path.join(bundleDirectory, ...artifact.path.split('/'));
  let handle;
  try {
    const initial = await lstat(artifactPath);
    if (initial.isSymbolicLink() || !initial.isFile() || initial.size !== artifact.byteLength) {
      throw new Error('Runtime artifact is not the declared bounded regular file.');
    }
    handle = await open(artifactPath, constants.O_RDONLY | constants.O_NOFOLLOW);
    const stat = await handle.stat();
    if (!stat.isFile() || stat.size !== artifact.byteLength) {
      throw new Error('Runtime artifact changed before materialization.');
    }
    const bytes = await handle.readFile();
    if (bytes.byteLength !== artifact.byteLength || sha256(bytes) !== artifact.sha256) {
      throw new Error('Runtime artifact bytes do not match the closed bundle manifest.');
    }
    await handle.close();
    handle = undefined;
    return Uint8Array.from(bytes);
  } catch (error) {
    try {
      await handle?.close();
    } catch {
      // Preserve the validation failure that made this artifact unusable.
    }
    throw materializationError(
      'HQ_RUNTIME_MATERIALIZATION_ARTIFACT_INVALID',
      'A deployment runtime artifact could not be materialized.',
      error,
    );
  }
}

function artifactSnapshot(
  input: {
    readonly runtime: 'node' | 'python';
    readonly artifactSha256: string;
    readonly entrypoints: readonly string[];
  },
  bytes: Uint8Array,
): DeploymentRuntimeArtifactSnapshot {
  const materialized = Uint8Array.from(bytes);
  return Object.freeze({
    runtime: input.runtime,
    artifactSha256: input.artifactSha256,
    byteLength: materialized.byteLength,
    entrypoints: Object.freeze([...input.entrypoints]),
    read: () => Uint8Array.from(materialized),
  });
}

async function materializeActivation(
  activation: DeploymentActivationRecord,
  releases: DeploymentRuntimeReleaseReader,
): Promise<DeploymentRuntimeSnapshot> {
  let stored: DeploymentRuntimeRelease | undefined;
  try {
    stored = await releases.read(activation.releaseIdentity);
  } catch (error) {
    throw materializationError(
      'HQ_RUNTIME_MATERIALIZATION_RELEASE_INVALID',
      'The active deployment release could not be revalidated.',
      error,
    );
  }
  if (!stored) {
    throw materializationError(
      'HQ_RUNTIME_MATERIALIZATION_RELEASE_NOT_FOUND',
      'The active deployment release was not found.',
    );
  }
  let release: ProtocolDeploymentReleaseEnvelope;
  let releaseIdentity: string;
  try {
    const prepared = prepareProtocolDeploymentReleaseEnvelope(stored.release);
    release = prepared.release;
    releaseIdentity = prepared.identity;
  } catch (error) {
    throw materializationError(
      'HQ_RUNTIME_MATERIALIZATION_RELEASE_INVALID',
      'The active deployment release envelope is invalid.',
      error,
    );
  }
  if (stored.releaseIdentity !== activation.releaseIdentity
    || releaseIdentity !== activation.releaseIdentity
    || !sameTarget(release.target, activation.target)
    || release.bundleIdentity !== stored.bundle.identity) {
    throw materializationError(
      'HQ_RUNTIME_MATERIALIZATION_RELEASE_INVALID',
      'The active deployment release is inconsistent with its activation or bundle.',
    );
  }

  let bundle: VerifiedDeploymentBundle;
  try {
    bundle = await verifyDeploymentBundle(stored.bundle.directory);
  } catch (error) {
    throw materializationError(
      'HQ_RUNTIME_MATERIALIZATION_RELEASE_INVALID',
      'The active deployment bundle could not be revalidated.',
      error,
    );
  }
  if (bundle.identity !== stored.bundle.identity
    || bundle.identity !== release.bundleIdentity) {
    throw materializationError(
      'HQ_RUNTIME_MATERIALIZATION_RELEASE_INVALID',
      'The active deployment bundle identity is inconsistent.',
    );
  }

  const entrypoints = new Map<string, string[]>();
  const queries: DeploymentRuntimeQueryBinding[] = [];
  for (const query of bundle.contract.queries) {
    const implementation = query.implementation;
    if (implementation.kind !== 'runtime-reference') continue;
    const names = entrypoints.get(implementation.artifactSha256) ?? [];
    names.push(implementation.entrypoint);
    entrypoints.set(implementation.artifactSha256, names);
    queries.push(Object.freeze({
      query: query.name,
      runtime: implementation.runtime,
      artifactSha256: implementation.artifactSha256,
      entrypoint: implementation.entrypoint,
    }));
  }

  const artifacts: DeploymentRuntimeArtifactSnapshot[] = [];
  for (const artifact of bundle.manifest.artifacts) {
    const bytes = await readArtifact(bundle.directory, artifact);
    artifacts.push(artifactSnapshot({
      runtime: artifact.runtime,
      artifactSha256: artifact.sha256,
      entrypoints: [...new Set(entrypoints.get(artifact.sha256) ?? [])].sort(),
    }, bytes));
  }
  artifacts.sort((left, right) => left.artifactSha256.localeCompare(right.artifactSha256));
  queries.sort((left, right) => left.query.localeCompare(right.query));

  return Object.freeze({
    target: activation.target,
    activation,
    release,
    releaseIdentity,
    bundleIdentity: bundle.identity,
    deployment: bundle.contract,
    artifacts: Object.freeze(artifacts),
    queries: Object.freeze(queries),
  });
}

function stabilityAttempts(input: number | undefined): number {
  const value = input ?? DEFAULT_STABILITY_ATTEMPTS;
  if (!Number.isSafeInteger(value) || value < 1 || value > MAX_STABILITY_ATTEMPTS) {
    throw materializationError(
      'HQ_RUNTIME_MATERIALIZATION_CONFIGURATION',
      `maxStabilityAttempts must be between 1 and ${MAX_STABILITY_ATTEMPTS}.`,
    );
  }
  return value;
}

export function createDeploymentRuntimeMaterializer(
  options: DeploymentRuntimeMaterializerOptions,
): DeploymentRuntimeMaterializer {
  const maximumAttempts = stabilityAttempts(options.maxStabilityAttempts);

  async function currentActivation(
    target: ProtocolDeploymentReleaseTarget,
  ): Promise<DeploymentActivationRecord | undefined> {
    try {
      const activation = await options.activations.current(target);
      if (!activation) return undefined;
      const validated = validateDeploymentActivationRecord(activation);
      if (!sameTarget(validated.target, target)) {
        throw new Error('Deployment activation target does not match the requested target.');
      }
      return validated;
    } catch (error) {
      throw materializationError(
        'HQ_RUNTIME_MATERIALIZATION_ACTIVATION_UNAVAILABLE',
        'Deployment activation state could not be read.',
        error,
      );
    }
  }

  return Object.freeze({
    async current(
      target: ProtocolDeploymentReleaseTarget,
    ): Promise<DeploymentRuntimeSnapshot | undefined> {
      for (let attempt = 0; attempt < maximumAttempts; attempt += 1) {
        const activation = await currentActivation(target);
        if (!activation) return undefined;
        const snapshot = await materializeActivation(activation, options.releases);
        const confirmed = await currentActivation(target);
        if (confirmed?.revision === activation.revision) return snapshot;
      }
      throw materializationError(
        'HQ_RUNTIME_MATERIALIZATION_UNSTABLE_ACTIVATION',
        'Deployment activation changed repeatedly during runtime materialization.',
      );
    },
  });
}
