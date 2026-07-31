import { createHash, randomUUID } from 'node:crypto';
import {
  constants,
  lstat,
  mkdir,
  mkdtemp,
  open,
  rename,
  rm,
  writeFile,
} from 'node:fs/promises';
import path from 'node:path';
import {
  DEFAULT_PROTOCOL_DEPLOYMENT_BUNDLE_LIMITS,
  prepareProtocolDeploymentBundleManifest,
  type PreparedProtocolDeploymentContract,
  type ProtocolDeploymentBundleManifest,
  type ProtocolDeploymentContract,
} from '@hypequery/protocol';
import {
  DEPLOYMENT_BUNDLE_CONTRACT,
  DEPLOYMENT_BUNDLE_MANIFEST,
  verifyDeploymentBundle,
} from '@hypequery/deployment';
import type { VerifiedDeploymentBundle } from '@hypequery/deployment';
import { logger } from './logger.js';

export {
  DEPLOYMENT_BUNDLE_CONTRACT,
  DEPLOYMENT_BUNDLE_MANIFEST,
  verifyDeploymentBundle,
};
export type { VerifiedDeploymentBundle };

export interface DeploymentBundleRuntimeFile {
  readonly runtime: 'node' | 'python';
  readonly sha256: string;
  readonly bytes: Uint8Array;
}

export interface DeploymentBundleSourceFile {
  readonly path: string;
  readonly bytes: Uint8Array;
}

export interface DeploymentBundleSourceSnapshot {
  readonly entrypoint: string;
  readonly files: readonly DeploymentBundleSourceFile[];
  readonly revision?: {
    readonly kind: 'git';
    readonly commit: string;
    readonly dirty: boolean;
    readonly branch?: string;
  };
}

export interface WrittenDeploymentBundle {
  readonly directory: string;
  readonly manifest: ProtocolDeploymentBundleManifest;
  readonly identity: string;
  readonly contract: ProtocolDeploymentContract;
}

const utf8Encoder = new TextEncoder();

function sha256(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

function runtimeArtifactPath(runtime: 'node' | 'python', digest: string): string {
  return `artifacts/${digest}.${runtime === 'node' ? 'mjs' : 'pyz'}`;
}

const SOURCE_ROOT = 'source';

function errorCode(error: unknown): string | undefined {
  return typeof error === 'object' && error !== null && 'code' in error
    ? String((error as { code?: unknown }).code)
    : undefined;
}

async function existingVerifiedBundle(outputDirectory: string): Promise<boolean> {
  try {
    await lstat(outputDirectory);
  } catch (error) {
    if (errorCode(error) === 'ENOENT') return false;
    throw error;
  }
  try {
    await verifyDeploymentBundle(outputDirectory);
  } catch (error) {
    throw new Error(
      'Refusing to replace an existing path that is not a valid deployment bundle: '
      + `${outputDirectory}\n\n`
      + (error instanceof Error ? error.message : String(error)),
    );
  }
  return true;
}

function validateRuntimeFiles(
  prepared: PreparedProtocolDeploymentContract,
  files: readonly DeploymentBundleRuntimeFile[],
): readonly DeploymentBundleRuntimeFile[] {
  requireClosedContractArtifactSet(prepared.contract);
  const declared = new Map(
    prepared.contract.artifacts.map(artifact => [artifact.artifactSha256, artifact.runtime]),
  );
  const supplied = new Map<string, 'node' | 'python'>();
  for (const file of files) {
    if (sha256(file.bytes) !== file.sha256) {
      throw new Error(`Runtime artifact bytes do not match SHA-256 ${file.sha256}.`);
    }
    if (declared.get(file.sha256) !== file.runtime) {
      throw new Error(
        `Runtime artifact ${file.sha256} is not declared by the deployment contract as ${file.runtime}.`,
      );
    }
    if (supplied.has(file.sha256)) {
      throw new Error(`Duplicate runtime artifact bytes supplied for ${file.sha256}.`);
    }
    if (file.bytes.byteLength < 1
      || file.bytes.byteLength > DEFAULT_PROTOCOL_DEPLOYMENT_BUNDLE_LIMITS.maxArtifactBytes) {
      throw new Error(`Runtime artifact ${file.sha256} exceeds the bundle byte limits.`);
    }
    supplied.set(file.sha256, file.runtime);
  }
  for (const [digest, runtime] of declared) {
    if (supplied.get(digest) !== runtime) {
      throw new Error(`Deployment bundle is missing ${runtime} runtime artifact ${digest}.`);
    }
  }
  return Object.freeze([...files].sort((left, right) => {
    const leftPath = runtimeArtifactPath(left.runtime, left.sha256);
    const rightPath = runtimeArtifactPath(right.runtime, right.sha256);
    return leftPath < rightPath ? -1 : leftPath > rightPath ? 1 : 0;
  }));
}

function requireClosedContractArtifactSet(contract: ProtocolDeploymentContract): void {
  const referenced = new Map<string, 'node' | 'python'>();
  for (const query of contract.queries) {
    if (query.implementation.kind === 'runtime-reference') {
      referenced.set(query.implementation.artifactSha256, query.implementation.runtime);
    }
  }
  if (referenced.size !== contract.artifacts.length) {
    throw new Error('Deployment contract contains missing or unreferenced runtime artifacts.');
  }
  for (const artifact of contract.artifacts) {
    if (referenced.get(artifact.artifactSha256) !== artifact.runtime) {
      throw new Error(
        `Deployment runtime artifact ${artifact.artifactSha256} is not referenced by a named query.`,
      );
    }
  }
}

function validateSourceSnapshot(
  source: DeploymentBundleSourceSnapshot | undefined,
): DeploymentBundleSourceSnapshot | undefined {
  if (!source) return undefined;
  const files = [...source.files].sort((left, right) =>
    left.path < right.path ? -1 : left.path > right.path ? 1 : 0);
  if (files.length < 1
    || files.length > DEFAULT_PROTOCOL_DEPLOYMENT_BUNDLE_LIMITS.maxSourceFiles) {
    throw new Error('Deployment source snapshot exceeds the bundle file limits.');
  }
  let totalBytes = 0;
  const seen = new Set<string>();
  for (const file of files) {
    const portable = file.path.split(path.sep).join('/');
    if (portable !== file.path || path.isAbsolute(file.path)
      || file.path.split('/').some(segment => !segment || segment === '.' || segment === '..')) {
      throw new Error(`Deployment source path must be project-relative: ${file.path}`);
    }
    const caseFolded = file.path.toLowerCase();
    if (seen.has(caseFolded)) {
      throw new Error(`Duplicate deployment source path: ${file.path}`);
    }
    seen.add(caseFolded);
    if (file.bytes.byteLength > DEFAULT_PROTOCOL_DEPLOYMENT_BUNDLE_LIMITS.maxSourceFileBytes) {
      throw new Error(`Deployment source file exceeds its byte limit: ${file.path}`);
    }
    totalBytes += file.bytes.byteLength;
  }
  if (totalBytes > DEFAULT_PROTOCOL_DEPLOYMENT_BUNDLE_LIMITS.maxSourceBytes) {
    throw new Error('Deployment source snapshot exceeds its total byte limit.');
  }
  if (!files.some(file => file.path === source.entrypoint)) {
    throw new Error('Deployment source snapshot does not contain its API entrypoint.');
  }
  return Object.freeze({
    entrypoint: source.entrypoint,
    files: Object.freeze(files),
    ...(source.revision ? { revision: Object.freeze({ ...source.revision }) } : {}),
  });
}

export async function writeDeploymentBundle(
  outputDirectory: string,
  prepared: PreparedProtocolDeploymentContract,
  runtimeFiles: readonly DeploymentBundleRuntimeFile[],
  sourceSnapshot?: DeploymentBundleSourceSnapshot,
): Promise<WrittenDeploymentBundle> {
  const destination = path.resolve(outputDirectory);
  if (destination === path.parse(destination).root) {
    throw new Error('The deployment bundle output cannot be a filesystem root.');
  }
  const files = validateRuntimeFiles(prepared, runtimeFiles);
  const source = validateSourceSnapshot(sourceSnapshot);
  const deploymentBytes = utf8Encoder.encode(`${prepared.canonical}\n`);
  const manifestInput = {
    kind: 'hypequery-deployment-bundle',
    version: 1,
    deployment: {
      path: DEPLOYMENT_BUNDLE_CONTRACT,
      identity: prepared.identity,
      sha256: sha256(deploymentBytes),
      byteLength: deploymentBytes.byteLength,
    },
    artifacts: files.map(file => ({
      runtime: file.runtime,
      path: runtimeArtifactPath(file.runtime, file.sha256),
      sha256: file.sha256,
      byteLength: file.bytes.byteLength,
    })),
    ...(source ? {
      source: {
        root: SOURCE_ROOT,
        entrypoint: source.entrypoint,
        files: source.files.map(file => ({
          path: file.path,
          sha256: sha256(file.bytes),
          byteLength: file.bytes.byteLength,
        })),
        ...(source.revision ? { revision: source.revision } : {}),
      },
    } : {}),
  };
  const preparedManifest = prepareProtocolDeploymentBundleManifest(manifestInput);
  const replaceExisting = await existingVerifiedBundle(destination);
  const parent = path.dirname(destination);
  await mkdir(parent, { recursive: true });
  const staging = await mkdtemp(path.join(parent, `.${path.basename(destination)}.tmp-`));
  try {
    if (files.length > 0) await mkdir(path.join(staging, 'artifacts'));
    await writeFile(path.join(staging, DEPLOYMENT_BUNDLE_CONTRACT), deploymentBytes, { flag: 'wx' });
    for (const file of files) {
      await writeFile(
        path.join(staging, runtimeArtifactPath(file.runtime, file.sha256)),
        file.bytes,
        { flag: 'wx' },
      );
    }
    for (const file of source?.files ?? []) {
      const outputPath = path.join(staging, SOURCE_ROOT, ...file.path.split('/'));
      await mkdir(path.dirname(outputPath), { recursive: true });
      await writeFile(outputPath, file.bytes, { flag: 'wx' });
    }
    await writeFile(
      path.join(staging, DEPLOYMENT_BUNDLE_MANIFEST),
      `${preparedManifest.canonical}\n`,
      { encoding: 'utf8', flag: 'wx' },
    );
    if (!replaceExisting) {
      await rename(staging, destination);
    } else {
      const backup = path.join(
        parent,
        `.${path.basename(destination)}.previous-${randomUUID()}`,
      );
      await rename(destination, backup);
      try {
        await rename(staging, destination);
      } catch (error) {
        await rename(backup, destination);
        throw error;
      }
      try {
        await rm(backup, { recursive: true });
      } catch (error) {
        logger.warn(
          `Deployment bundle was replaced, but its previous backup could not be removed: ${backup}`
          + ` (${error instanceof Error ? error.message : String(error)})`,
        );
      }
    }
  } catch (error) {
    await rm(staging, { force: true, recursive: true });
    throw error;
  }

  return Object.freeze({
    directory: destination,
    manifest: preparedManifest.manifest,
    identity: preparedManifest.identity,
    contract: prepared.contract,
  });
}

async function readBoundedAbsoluteRegularFile(
  absolutePath: string,
  displayPath: string,
  maximum: number,
): Promise<Uint8Array> {
  let handle;
  try {
    const initialStat = await lstat(absolutePath);
    if (initialStat.isSymbolicLink()) {
      throw new Error(`Bundle entry must not be a symbolic link: ${displayPath}`);
    }
    if (!initialStat.isFile()) {
      throw new Error(`Bundle entry is not a regular file: ${displayPath}`);
    }
    if (initialStat.size < 1 || initialStat.size > maximum) {
      throw new Error(`Bundle entry exceeds its byte limit: ${displayPath}`);
    }
    handle = await open(absolutePath, constants.O_RDONLY | constants.O_NOFOLLOW);
    const stat = await handle.stat();
    if (!stat.isFile()) throw new Error(`Bundle entry is not a regular file: ${displayPath}`);
    if (stat.size < 1 || stat.size > maximum) {
      throw new Error(`Bundle entry exceeds its byte limit: ${displayPath}`);
    }
    return await handle.readFile();
  } catch (error) {
    if (errorCode(error) === 'ELOOP') {
      throw new Error(`Bundle entry must not be a symbolic link: ${displayPath}`);
    }
    throw error;
  } finally {
    await handle?.close();
  }
}

export async function readDeploymentRuntimeFile(filePath: string): Promise<Uint8Array> {
  return readBoundedAbsoluteRegularFile(
    path.resolve(filePath),
    filePath,
    DEFAULT_PROTOCOL_DEPLOYMENT_BUNDLE_LIMITS.maxArtifactBytes,
  );
}
