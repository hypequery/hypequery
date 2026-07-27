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
import {
  loadCloudCredential,
  type StoredCloudCredential,
} from '../utils/cloud-credential-store.js';

const MAX_RELEASE_FILE_BYTES = 16 * 1024;
const utf8Decoder = new TextDecoder('utf-8', { fatal: true });

function sameOrigin(left: string, right: string): boolean {
  try {
    return new URL(left).origin === new URL(right).origin;
  } catch {
    return false;
  }
}

export interface DeployOptions {
  release?: string;
  endpoint?: string;
}

export interface DeployDependencies {
  readonly env?: Readonly<Record<string, string | undefined>>;
  readonly createTransport?: typeof createHttpDeploymentUploadTransport;
  readonly loadCredential?: () => Promise<StoredCloudCredential | null>;
}

async function readReleaseFile(releasePath: string): Promise<unknown> {
  let handle;
  let bytes: Uint8Array | undefined;
  let fileFailure: { readonly error: unknown } | undefined;
  try {
    handle = await open(releasePath, constants.O_RDONLY | constants.O_NOFOLLOW);
    const stat = await handle.stat();
    if (!stat.isFile()) throw new Error('Release JSON must be a regular file.');
    if (stat.size > MAX_RELEASE_FILE_BYTES) {
      throw new Error('Release JSON exceeds 16384 bytes.');
    }
    const buffer = new Uint8Array(MAX_RELEASE_FILE_BYTES + 1);
    let total = 0;
    while (total < buffer.byteLength) {
      const { bytesRead } = await handle.read(buffer, total, buffer.byteLength - total, total);
      if (bytesRead === 0) break;
      total += bytesRead;
    }
    if (total > MAX_RELEASE_FILE_BYTES) {
      throw new Error('Release JSON exceeds 16384 bytes.');
    }
    bytes = buffer.subarray(0, total);
  } catch (error) {
    fileFailure = { error };
  }
  if (handle) {
    try {
      await handle.close();
    } catch (error) {
      fileFailure ??= { error };
    }
  }
  if (fileFailure) {
    throw new Error(
      `Cannot read deployment release file: ${releasePath}\n\n`
      + (fileFailure.error instanceof Error
        ? fileFailure.error.message
        : String(fileFailure.error)),
    );
  }
  try {
    return JSON.parse(utf8Decoder.decode(bytes));
  } catch (error) {
    throw new Error(
      `Invalid deployment release JSON: ${releasePath}\n\n`
      + (error instanceof Error ? error.message : String(error)),
    );
  }
}

function requiredConfiguration(
  value: string | undefined,
  message: string,
): string {
  if (value === undefined || value.length === 0) throw new Error(message);
  return value;
}

export async function deployCommand(
  bundlePath: string | undefined,
  options: DeployOptions = {},
  dependencies: DeployDependencies = {},
): Promise<DeploymentSubmissionResponse> {
  if (!bundlePath) {
    throw new Error(
      'Missing deployment bundle path.\n\n'
      + 'Usage: hypequery deploy analytics/hypequery-deployment '
      + '--release analytics/hypequery-deployment.release.json',
    );
  }
  const releasePath = requiredConfiguration(
    options.release,
    'Missing required --release <path>.',
  );
  const env = dependencies.env ?? process.env;
  let endpoint = options.endpoint ?? env.HYPEQUERY_DEPLOYMENT_ENDPOINT;
  let token = env.HYPEQUERY_API_TOKEN;
  if (!endpoint || !token) {
    const loadCredential = dependencies.loadCredential
      ?? (dependencies.env === undefined
        ? loadCloudCredential
        : async () => null);
    const credential = await loadCredential();
    if (credential) {
      // The stored token authenticates one Cloud. An explicit --endpoint or
      // HYPEQUERY_DEPLOYMENT_ENDPOINT aimed anywhere else must never receive
      // it, or a mistyped or hostile endpoint silently exfiltrates the
      // credential the user never typed.
      const resolved = endpoint ?? credential.deploymentEndpoint;
      if (!token) {
        if (!sameOrigin(resolved, credential.cloudUrl)) {
          throw new Error(
            `The stored Cloud credential belongs to ${credential.cloudUrl} and will not be `
            + `sent to ${resolved}.\n\n`
            + 'Drop --endpoint/HYPEQUERY_DEPLOYMENT_ENDPOINT to use the logged-in Cloud, '
            + 'or set HYPEQUERY_API_TOKEN for this endpoint.',
          );
        }
        if (Date.parse(credential.expiresAt) <= Date.now()) {
          throw new Error('The stored Cloud credential has expired. Run `hypequery login` again.');
        }
        token = credential.token;
      }
      endpoint = resolved;
    }
  }
  endpoint = requiredConfiguration(
    endpoint,
    'Missing deployment endpoint. Run `hypequery login`, pass --endpoint, or set HYPEQUERY_DEPLOYMENT_ENDPOINT.',
  );
  token = requiredConfiguration(
    token,
    'Missing deployment credential. Run `hypequery login` or set HYPEQUERY_API_TOKEN.',
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
