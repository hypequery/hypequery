import { constants, open } from 'node:fs/promises';
import {
  prepareProtocolDeploymentReleaseEnvelope,
} from '@hypequery/protocol';
import { verifyDeploymentBundle } from '../utils/deployment-bundle.js';
import {
  createHttpDeploymentUploadTransport,
  DeploymentUploadError,
  type DeploymentSubmissionResponse,
  type HttpDeploymentUploadTransportOptions,
} from '../utils/deployment-upload.js';
import { logger } from '../utils/logger.js';

const MAX_RELEASE_FILE_BYTES = 16 * 1024;
const utf8Decoder = new TextDecoder('utf-8', { fatal: true });

export interface PushDeploymentOptions {
  release?: string;
  endpoint?: string;
}

export interface PushDeploymentDependencies {
  readonly env?: Readonly<Record<string, string | undefined>>;
  readonly createTransport?: typeof createHttpDeploymentUploadTransport;
}

async function readReleaseFile(releasePath: string): Promise<unknown> {
  let handle;
  try {
    handle = await open(releasePath, constants.O_RDONLY | constants.O_NOFOLLOW);
    const stat = await handle.stat();
    if (!stat.isFile()) throw new Error('Release JSON must be a regular file.');
    if (stat.size > MAX_RELEASE_FILE_BYTES) {
      throw new Error('Release JSON exceeds 16384 bytes.');
    }
    const bytes = new Uint8Array(MAX_RELEASE_FILE_BYTES + 1);
    let total = 0;
    while (total < bytes.byteLength) {
      const { bytesRead } = await handle.read(bytes, total, bytes.byteLength - total, total);
      if (bytesRead === 0) break;
      total += bytesRead;
    }
    if (total > MAX_RELEASE_FILE_BYTES) {
      throw new Error('Release JSON exceeds 16384 bytes.');
    }
    return JSON.parse(utf8Decoder.decode(bytes.subarray(0, total)));
  } catch (error) {
    throw new Error(
      `Invalid deployment release JSON: ${releasePath}\n\n`
      + (error instanceof Error ? error.message : String(error)),
    );
  } finally {
    await handle?.close();
  }
}

function requiredConfiguration(
  value: string | undefined,
  message: string,
): string {
  if (value === undefined || value.length === 0) throw new Error(message);
  return value;
}

export async function pushDeploymentCommand(
  bundlePath: string | undefined,
  options: PushDeploymentOptions = {},
  dependencies: PushDeploymentDependencies = {},
): Promise<DeploymentSubmissionResponse> {
  if (!bundlePath) {
    throw new Error(
      'Missing deployment bundle path.\n\n'
      + 'Usage: hypequery deployment:push analytics/hypequery-deployment '
      + '--release analytics/hypequery-deployment.release.json',
    );
  }
  const releasePath = requiredConfiguration(
    options.release,
    'Missing required --release <path>.',
  );
  const env = dependencies.env ?? process.env;
  const endpoint = requiredConfiguration(
    options.endpoint ?? env.HYPEQUERY_DEPLOYMENT_ENDPOINT,
    'Missing deployment endpoint. Pass --endpoint or set HYPEQUERY_DEPLOYMENT_ENDPOINT.',
  );
  const token = requiredConfiguration(
    env.HYPEQUERY_API_TOKEN,
    'Missing HYPEQUERY_API_TOKEN.',
  );

  let bundle: Awaited<ReturnType<typeof verifyDeploymentBundle>>;
  try {
    bundle = await verifyDeploymentBundle(bundlePath);
  } catch (error) {
    throw new Error(
      `Cannot push an invalid deployment bundle: ${bundlePath}\n\n`
      + (error instanceof Error ? error.message : String(error)),
    );
  }
  const releaseInput = await readReleaseFile(releasePath);
  let release: ReturnType<typeof prepareProtocolDeploymentReleaseEnvelope>;
  try {
    release = prepareProtocolDeploymentReleaseEnvelope(releaseInput);
  } catch (error) {
    throw new Error(
      `Invalid deployment release: ${releasePath}\n\n`
      + (error instanceof Error ? error.message : String(error)),
    );
  }
  if (release.release.bundleIdentity !== bundle.identity) {
    throw new DeploymentUploadError(
      'HQ_UPLOAD_IDENTITY_MISMATCH',
      'Release bundle identity does not match the verified deployment bundle.',
    );
  }
  const createTransport = dependencies.createTransport ?? createHttpDeploymentUploadTransport;
  const transportOptions: HttpDeploymentUploadTransportOptions = { endpoint, token };
  const result = await createTransport(transportOptions).submit(bundle, release);
  logger.success(
    result.status === 'accepted'
      ? 'Deployment release accepted'
      : 'Deployment release already exists',
  );
  logger.info(`Release identity: ${result.releaseIdentity}`);
  logger.info(`Bundle identity: ${result.bundleIdentity}`);
  return result;
}
