import { createHash } from 'node:crypto';
import {
  constants,
  lstat,
  open,
  readdir,
} from 'node:fs/promises';
import path from 'node:path';
import {
  DEFAULT_PROTOCOL_DEPLOYMENT_BUNDLE_LIMITS,
  prepareProtocolDeploymentBundleManifest,
  prepareProtocolDeploymentContract,
  type ProtocolDeploymentBundleManifest,
  type ProtocolDeploymentContract,
} from '@hypequery/protocol';

export const DEPLOYMENT_BUNDLE_MANIFEST = 'bundle.json';
export const DEPLOYMENT_BUNDLE_CONTRACT = 'deployment.json';

export interface VerifiedDeploymentBundle {
  readonly directory: string;
  readonly manifest: ProtocolDeploymentBundleManifest;
  readonly identity: string;
  readonly contract: ProtocolDeploymentContract;
}

const utf8Decoder = new TextDecoder('utf-8', { fatal: true });
const utf8Encoder = new TextEncoder();

function errorCode(error: unknown): string | undefined {
  return typeof error === 'object' && error !== null && 'code' in error
    ? String((error as { code?: unknown }).code)
    : undefined;
}

function sha256(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

async function readBoundedRegularFile(
  root: string,
  relativePath: string,
  maximum: number,
  allowEmpty = false,
): Promise<Uint8Array> {
  const absolutePath = path.join(root, ...relativePath.split('/'));
  let handle;
  try {
    const initialStat = await lstat(absolutePath);
    if (initialStat.isSymbolicLink()) {
      throw new Error(`Bundle entry must not be a symbolic link: ${relativePath}`);
    }
    if (!initialStat.isFile()) {
      throw new Error(`Bundle entry is not a regular file: ${relativePath}`);
    }
    if (initialStat.size < (allowEmpty ? 0 : 1) || initialStat.size > maximum) {
      throw new Error(`Bundle entry exceeds its byte limit: ${relativePath}`);
    }
    handle = await open(absolutePath, constants.O_RDONLY | constants.O_NOFOLLOW);
    const stat = await handle.stat();
    if (!stat.isFile()) throw new Error(`Bundle entry is not a regular file: ${relativePath}`);
    if (stat.size < (allowEmpty ? 0 : 1) || stat.size > maximum) {
      throw new Error(`Bundle entry exceeds its byte limit: ${relativePath}`);
    }
    return await handle.readFile();
  } catch (error) {
    if (errorCode(error) === 'ELOOP') {
      throw new Error(`Bundle entry must not be a symbolic link: ${relativePath}`);
    }
    throw error;
  } finally {
    await handle?.close();
  }
}

function expectedDirectories(files: readonly string[]): ReadonlySet<string> {
  const result = new Set<string>();
  for (const file of files) {
    const segments = file.split('/');
    for (let index = 1; index < segments.length; index += 1) {
      result.add(segments.slice(0, index).join('/'));
    }
  }
  return result;
}

async function verifyExactEntries(
  root: string,
  manifest: ProtocolDeploymentBundleManifest,
): Promise<void> {
  const expectedFiles = new Set([
    DEPLOYMENT_BUNDLE_MANIFEST,
    manifest.deployment.path,
    ...manifest.artifacts.map(artifact => artifact.path),
    ...(manifest.source?.files.map(file => `${manifest.source!.root}/${file.path}`) ?? []),
  ]);
  const expectedDirectoryPaths = expectedDirectories([...expectedFiles]);
  const seenFiles = new Set<string>();
  const seenDirectories = new Set<string>();
  async function visit(relativeDirectory: string): Promise<void> {
    const absoluteDirectory = relativeDirectory
      ? path.join(root, ...relativeDirectory.split('/'))
      : root;
    const names = await readdir(absoluteDirectory);
    names.sort();
    for (const name of names) {
      const relativePath = relativeDirectory ? `${relativeDirectory}/${name}` : name;
      const stat = await lstat(path.join(absoluteDirectory, name));
      if (stat.isSymbolicLink()) {
        throw new Error(`Bundle entries must not be symbolic links: ${relativePath}`);
      }
      if (stat.isDirectory()) {
        if (!expectedDirectoryPaths.has(relativePath)) {
          throw new Error(`Deployment bundle contains an undeclared directory: ${relativePath}`);
        }
        seenDirectories.add(relativePath);
        await visit(relativePath);
      } else if (stat.isFile()) {
        if (!expectedFiles.has(relativePath)) {
          throw new Error(`Deployment bundle contains an undeclared file: ${relativePath}`);
        }
        seenFiles.add(relativePath);
      } else {
        throw new Error(`Bundle entry is not a regular file or directory: ${relativePath}`);
      }
    }
  }
  await visit('');
  const missingFiles = [...expectedFiles].filter(file => !seenFiles.has(file)).sort();
  if (missingFiles.length > 0) {
    throw new Error(`Deployment bundle is missing files: ${missingFiles.join(', ')}`);
  }
  const missingDirectories = [...expectedDirectoryPaths]
    .filter(directory => !seenDirectories.has(directory)).sort();
  if (missingDirectories.length > 0) {
    throw new Error(`Deployment bundle is missing directories: ${missingDirectories.join(', ')}`);
  }
}

function verifyFile(
  bytes: Uint8Array,
  file: { path: string; sha256: string; byteLength: number },
): void {
  if (bytes.byteLength !== file.byteLength) {
    throw new Error(`Bundle entry byte length does not match the manifest: ${file.path}`);
  }
  if (sha256(bytes) !== file.sha256) {
    throw new Error(`Bundle entry SHA-256 does not match the manifest: ${file.path}`);
  }
}

export async function verifyDeploymentBundle(
  bundleDirectory: string,
): Promise<VerifiedDeploymentBundle> {
  const root = path.resolve(bundleDirectory);
  const rootStat = await lstat(root);
  if (rootStat.isSymbolicLink() || !rootStat.isDirectory()) {
    throw new Error(`Deployment bundle path must be a regular directory: ${bundleDirectory}`);
  }
  const manifestBytes = await readBoundedRegularFile(root, DEPLOYMENT_BUNDLE_MANIFEST, 1024 * 1024);
  let input: unknown;
  try {
    input = JSON.parse(utf8Decoder.decode(manifestBytes));
  } catch (error) {
    throw new Error(
      `Invalid deployment bundle manifest: ${path.join(root, DEPLOYMENT_BUNDLE_MANIFEST)}\n\n`
      + (error instanceof Error ? error.message : String(error)),
    );
  }
  const preparedManifest = prepareProtocolDeploymentBundleManifest(input);
  if (preparedManifest.manifest.artifacts.length > 0) {
    throw new Error('A deployment bundle cannot contain runtime artifacts.');
  }
  const expectedManifestBytes = utf8Encoder.encode(`${preparedManifest.canonical}\n`);
  if (!Buffer.from(manifestBytes).equals(Buffer.from(expectedManifestBytes))) {
    throw new Error('Deployment bundle manifest must contain canonical JSON followed by one newline.');
  }
  await verifyExactEntries(root, preparedManifest.manifest);

  const deployment = preparedManifest.manifest.deployment;
  const deploymentBytes = await readBoundedRegularFile(
    root,
    deployment.path,
    DEFAULT_PROTOCOL_DEPLOYMENT_BUNDLE_LIMITS.maxDeploymentBytes,
  );
  verifyFile(deploymentBytes, deployment);
  let contractInput: unknown;
  try {
    contractInput = JSON.parse(utf8Decoder.decode(deploymentBytes));
  } catch (error) {
    throw new Error(
      `Invalid deployment JSON in bundle: ${deployment.path}\n\n`
      + (error instanceof Error ? error.message : String(error)),
    );
  }
  const preparedContract = prepareProtocolDeploymentContract(contractInput);
  if (preparedContract.identity !== deployment.identity) {
    throw new Error('Deployment identity does not match the bundle manifest.');
  }

  const source = preparedManifest.manifest.source;
  if (source) {
    for (const file of source.files) {
      const bundlePath = `${source.root}/${file.path}`;
      const bytes = await readBoundedRegularFile(
        root,
        bundlePath,
        DEFAULT_PROTOCOL_DEPLOYMENT_BUNDLE_LIMITS.maxSourceFileBytes,
        true,
      );
      verifyFile(bytes, { ...file, path: bundlePath });
    }
  }
  return Object.freeze({
    directory: root,
    manifest: preparedManifest.manifest,
    identity: preparedManifest.identity,
    contract: preparedContract.contract,
  });
}
