import { createHash, randomUUID } from 'node:crypto';
import {
  lstat,
  mkdir,
  mkdtemp,
  rename,
  rm,
  writeFile,
} from 'node:fs/promises';
import path from 'node:path';
import {
  DEFAULT_PROTOCOL_DEPLOYMENT_BUNDLE_LIMITS,
  prepareProtocolDeploymentBundleManifest,
  type PreparedProtocolDatasetOnlyContract,
  type ProtocolDatasetOnlyContract,
  type ProtocolDeploymentBundleManifest,
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
  readonly contract: ProtocolDatasetOnlyContract;
}

const utf8Encoder = new TextEncoder();

function sha256(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
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
  prepared: PreparedProtocolDatasetOnlyContract,
  sourceSnapshot?: DeploymentBundleSourceSnapshot,
): Promise<WrittenDeploymentBundle> {
  const destination = path.resolve(outputDirectory);
  if (destination === path.parse(destination).root) {
    throw new Error('The deployment bundle output cannot be a filesystem root.');
  }
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
    // A deployment carries datasets: there is nothing else to put here.
    artifacts: [],
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
    await writeFile(path.join(staging, DEPLOYMENT_BUNDLE_CONTRACT), deploymentBytes, { flag: 'wx' });
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
