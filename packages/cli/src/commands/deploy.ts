import { access, constants, open } from 'node:fs/promises';
import path from 'node:path';
import {
  prepareProtocolDeploymentReleaseEnvelope,
} from '@hypequery/protocol';
import {
  DEPLOYMENT_BUNDLE_MANIFEST,
  verifyDeploymentBundle,
} from '../utils/deployment-bundle.js';
import {
  createHttpDeploymentUploadTransport,
  DeploymentUploadError,
  type DeploymentSubmissionResponse,
  type HttpDeploymentUploadTransportOptions,
} from '../utils/deployment-upload.js';
import { logger } from '../utils/logger.js';
import {
  type StoredCloudCredential,
} from '../utils/cloud-credential-store.js';
import { resolveDeploymentCredential } from '../utils/cloud-deployment-access.js';
import { fetchLiveDeployment } from '../utils/live-deployment.js';
import {
  buildDeploymentCommand,
  prepareDeploymentReleaseCommand,
} from './deployment.js';

const MAX_RELEASE_FILE_BYTES = 16 * 1024;
const DEFAULT_BUNDLE_PATH = 'analytics/hypequery-deployment';
const utf8Decoder = new TextDecoder('utf-8', { fatal: true });

export interface SubmitDeploymentOptions {
  release?: string;
  endpoint?: string;
  replaceRestored?: boolean;
}

export interface DeployOptions extends SubmitDeploymentOptions {
  project?: string;
  environment?: string;
  bundleOutput?: string;
  releaseOutput?: string;
  source?: boolean;
  allowUnsupportedConfig?: boolean;
}

export interface SubmitDeploymentDependencies {
  readonly env?: Readonly<Record<string, string | undefined>>;
  readonly createTransport?: typeof createHttpDeploymentUploadTransport;
  readonly loadCredential?: () => Promise<StoredCloudCredential | null>;
  readonly fetchLive?: typeof fetchLiveDeployment;
}

export interface DeployDependencies extends SubmitDeploymentDependencies {
  readonly buildDeployment?: typeof buildDeploymentCommand;
  readonly prepareDeploymentRelease?: typeof prepareDeploymentReleaseCommand;
  readonly submitDeployment?: typeof submitDeploymentCommand;
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

export async function submitDeploymentCommand(
  bundlePath: string | undefined,
  options: SubmitDeploymentOptions = {},
  dependencies: SubmitDeploymentDependencies = {},
): Promise<DeploymentSubmissionResponse> {
  if (!bundlePath) {
    throw new Error(
      'Missing deployment bundle path.\n\n'
      + 'Usage: hypequery deployment:submit analytics/hypequery-deployment '
      + '--release analytics/hypequery-deployment.release.json',
    );
  }
  const releasePath = requiredConfiguration(
    options.release,
    'Missing required --release <path>.',
  );
  const { endpoint: deploymentEndpoint, token } = await resolveDeploymentCredential(
    options.endpoint,
    dependencies,
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
  const live = await (dependencies.fetchLive ?? fetchLiveDeployment)({
    endpoint: deploymentEndpoint,
    token,
    target: release.release.target,
    resource: 'state',
  });
  if (live?.active?.restored
    && live.active.releaseIdentity !== release.identity
    && !options.replaceRestored) {
    throw new Error(
      'The live deployment is a restored release. '
      + 'Run the command again with --replace-restored to replace it intentionally.',
    );
  }
  const createTransport = dependencies.createTransport ?? createHttpDeploymentUploadTransport;
  const transportOptions: HttpDeploymentUploadTransportOptions = {
    endpoint: deploymentEndpoint,
    token,
    ...(live
      ? { expectedActivationRevision: live.active?.revision ?? null }
      : {}),
    ...(options.replaceRestored ? { replaceRestored: true } : {}),
  };
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

/**
 * `deploy` takes an API module, but the deprecated form took a bundle
 * directory. Dropping `--release` from an existing script would otherwise hand
 * a bundle to the module loader and fail inside esbuild.
 */
async function rejectBundleDirectorySource(sourcePath: string): Promise<void> {
  try {
    await access(path.join(sourcePath, DEPLOYMENT_BUNDLE_MANIFEST));
  } catch {
    return;
  }
  throw new Error(
    `Cannot deploy a prebuilt bundle directory: ${sourcePath}\n\n`
    + '`hypequery deploy` takes the API module to build, for example '
    + '`hypequery deploy analytics/api.ts`.\n'
    + 'To upload this bundle, use `hypequery deployment:submit '
    + `${sourcePath} --release <file>\`.`,
  );
}

/**
 * `deploy` exposes no runtime flags, so a runtime error from the shared build
 * command would otherwise point at flags this command does not accept.
 */
function withRuntimeFlagHint(error: unknown): unknown {
  if (!(error instanceof Error) || !error.message.includes('--runtime')) return error;
  return new Error(
    `${error.message}\n\n`
    + 'Runtime overrides are not available on `hypequery deploy`. Build with '
    + '`hypequery deployment:build` (which accepts --runtime, --runtime-artifact, '
    + 'and --runtime-file), then upload with `hypequery deployment:submit`.',
  );
}

function rejectLegacyOrchestrationOptions(options: DeployOptions) {
  if (
    options.project !== undefined
    || options.environment !== undefined
    || options.bundleOutput !== undefined
    || options.releaseOutput !== undefined
  ) {
    throw new Error(
      '--release selects prebuilt submission mode and cannot be combined with '
      + '--project, --environment, --bundle-output, or --release-output. '
      + 'Use `hypequery deployment:submit` for explicit prebuilt uploads.',
    );
  }
}

export async function deployCommand(
  sourcePath: string | undefined,
  options: DeployOptions = {},
  dependencies: DeployDependencies = {},
): Promise<DeploymentSubmissionResponse> {
  if (!sourcePath) {
    throw new Error(
      'Missing API module path.\n\n'
      + 'Usage: hypequery deploy analytics/api.ts',
    );
  }

  if (options.release !== undefined) {
    rejectLegacyOrchestrationOptions(options);
    logger.warn(
      '`hypequery deploy <bundle> --release <file>` is deprecated. '
      + 'Use `hypequery deployment:submit <bundle> --release <file>` instead.',
    );
    return submitDeploymentCommand(sourcePath, {
      release: options.release,
      endpoint: options.endpoint,
      replaceRestored: options.replaceRestored,
    }, dependencies);
  }

  await rejectBundleDirectorySource(sourcePath);

  const bundlePath = options.bundleOutput ?? DEFAULT_BUNDLE_PATH;
  const releasePath = options.releaseOutput
    ?? `${bundlePath.replace(/[\\/]+$/, '')}.release.json`;
  const build = dependencies.buildDeployment ?? buildDeploymentCommand;
  const prepareRelease = dependencies.prepareDeploymentRelease
    ?? prepareDeploymentReleaseCommand;
  const submit = dependencies.submitDeployment ?? submitDeploymentCommand;

  // Resolve credentials up front. Submission is the last step, so without this
  // a missing or expired login only surfaces after a full bundle build.
  await resolveDeploymentCredential(options.endpoint, dependencies);

  try {
    await build(sourcePath, {
      bundleOutput: bundlePath,
      source: options.source,
      allowUnsupportedConfig: options.allowUnsupportedConfig,
    });
  } catch (error) {
    throw withRuntimeFlagHint(error);
  }
  await prepareRelease(bundlePath, {
    project: options.project,
    environment: options.environment,
    output: releasePath,
  }, {
    loadCredential: dependencies.loadCredential,
    outputFlagLabel: '--release-output',
  });
  return submit(bundlePath, {
    release: releasePath,
    endpoint: options.endpoint,
    replaceRestored: options.replaceRestored,
  }, dependencies);
}
