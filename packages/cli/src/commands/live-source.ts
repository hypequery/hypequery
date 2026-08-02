import { createHash, randomUUID } from 'node:crypto';
import { mkdir, rename, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import {
  validateProtocolDeploymentReleaseTarget,
  type ProtocolDeploymentReleaseTarget,
} from '@hypequery/protocol';
import {
  CLOUD_SOURCE_SCOPE,
  type StoredCloudCredential,
} from '../utils/cloud-credential-store.js';
import {
  resolveDeploymentCredential,
  type CloudDeploymentAccessDependencies,
} from '../utils/cloud-deployment-access.js';
import { captureDeploymentSourceSnapshot } from '../utils/deployment-source-snapshot.js';
import {
  fetchLiveDeployment,
  type LiveDeployment,
} from '../utils/live-deployment.js';
import { logger } from '../utils/logger.js';

export interface LiveSourceOptions {
  readonly endpoint?: string;
  readonly project?: string;
  readonly environment?: string;
}

export interface PullOptions extends LiveSourceOptions {
  readonly output?: string;
}

export interface LiveSourceDependencies extends CloudDeploymentAccessDependencies {
  readonly fetchLive?: typeof fetchLiveDeployment;
  readonly captureSource?: typeof captureDeploymentSourceSnapshot;
}

export type LiveSourceDifference = {
  readonly status: 'A' | 'M' | 'D';
  readonly path: string;
};

function targetFromOptions(
  options: LiveSourceOptions,
  credential: StoredCloudCredential | undefined,
): ProtocolDeploymentReleaseTarget {
  if ((options.project === undefined) !== (options.environment === undefined)) {
    throw new Error('Pass both --project and --environment, or omit both.');
  }
  const input = options.project === undefined
    ? credential?.target
    : { project: options.project, environment: options.environment };
  if (!input) {
    throw new Error(
      'Missing deployment target. Run `hypequery login` or pass both '
      + '--project and --environment.',
    );
  }
  try {
    return validateProtocolDeploymentReleaseTarget(input);
  } catch {
    throw new Error('The deployment target is invalid.');
  }
}

async function liveSource(
  options: LiveSourceOptions,
  dependencies: LiveSourceDependencies,
): Promise<LiveDeployment & { readonly active: NonNullable<LiveDeployment['active']> }> {
  const access = await resolveDeploymentCredential(options.endpoint, dependencies);
  if (access.storedCredential
    && access.storedCredential.scope !== CLOUD_SOURCE_SCOPE) {
    throw new Error(
      'The stored CLI credential cannot read deployed source. Run `hypequery login` again.',
    );
  }
  const target = targetFromOptions(options, access.storedCredential);
  const live = await (dependencies.fetchLive ?? fetchLiveDeployment)({
    endpoint: access.endpoint,
    token: access.token,
    target,
    resource: 'source',
  });
  if (!live?.active?.source) {
    throw new Error('The live deployment does not include a source snapshot.');
  }
  return live as LiveDeployment & {
    readonly active: NonNullable<LiveDeployment['active']>;
  };
}

function digest(bytes: Uint8Array) {
  return createHash('sha256').update(bytes).digest('hex');
}

async function exists(input: string) {
  try {
    await stat(input);
    return true;
  } catch (error) {
    if (typeof error === 'object' && error !== null && 'code' in error
      && (error as { code?: unknown }).code === 'ENOENT') return false;
    throw error;
  }
}

export async function pullCommand(
  options: PullOptions = {},
  dependencies: LiveSourceDependencies = {},
) {
  const live = await liveSource(options, dependencies);
  const active = live.active;
  const source = active.source!;
  const destination = path.resolve(
    options.output
      ?? path.join(
        '.hypequery',
        'live',
        live.target.environment,
        active.releaseIdentity.slice(0, 12),
      ),
  );
  if (destination === path.parse(destination).root || await exists(destination)) {
    throw new Error(`Refusing to overwrite an existing pull destination: ${destination}`);
  }
  const parent = path.dirname(destination);
  await mkdir(parent, { recursive: true });
  const staging = path.join(
    parent,
    `.${path.basename(destination)}.${randomUUID()}.tmp`,
  );
  await mkdir(staging, { mode: 0o700 });
  try {
    for (const file of source.files) {
      const output = path.join(staging, ...file.path.split('/'));
      await mkdir(path.dirname(output), { recursive: true });
      await writeFile(output, file.bytes, { flag: 'wx' });
    }
    await rename(staging, destination);
  } catch (error) {
    await rm(staging, { recursive: true, force: true }).catch(() => undefined);
    throw error;
  }
  logger.success(`Live source pulled to ${destination}`);
  logger.info(`Release identity: ${active.releaseIdentity}`);
  logger.info(`Entrypoint: ${source.entrypoint}`);
  return destination;
}

export async function diffCommand(
  sourcePath: string | undefined,
  options: LiveSourceOptions = {},
  dependencies: LiveSourceDependencies = {},
): Promise<readonly LiveSourceDifference[]> {
  const live = await liveSource(options, dependencies);
  const active = live.active;
  const source = active.source!;
  const local = await (dependencies.captureSource ?? captureDeploymentSourceSnapshot)(
    sourcePath ?? source.entrypoint,
  );
  const liveFiles = new Map(source.files.map(file => [file.path, file.sha256]));
  const localFiles = new Map(local.files.map(file => [file.path, digest(file.bytes)]));
  const paths = [...new Set([...liveFiles.keys(), ...localFiles.keys()])].sort();
  const differences: LiveSourceDifference[] = [];
  for (const file of paths) {
    const liveDigest = liveFiles.get(file);
    const localDigest = localFiles.get(file);
    if (liveDigest === undefined) differences.push({ status: 'A', path: file });
    else if (localDigest === undefined) differences.push({ status: 'D', path: file });
    else if (liveDigest !== localDigest) differences.push({ status: 'M', path: file });
  }
  if (differences.length === 0) {
    logger.success('Local source matches the live deployment');
  } else {
    for (const difference of differences) {
      logger.info(`${difference.status} ${difference.path}`);
    }
  }
  return Object.freeze(differences);
}
