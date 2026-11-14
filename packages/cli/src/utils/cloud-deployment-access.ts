import type { ProtocolDeploymentReleaseTarget } from '@hypequery/protocol';
import { CliError } from './cli-error.js';
import {
  loadCloudCredential,
  type StoredCloudCredential,
} from './cloud-credential-store.js';
import { cloudOriginFromEnv, defaultDeploymentEndpoint } from './cloud-origin.js';
import { cloudTokenKind, type CloudTokenKind } from './cloud-token-kind.js';
import {
  loadManagementCredential,
  type StoredManagementCredential,
} from './management-token-store.js';

export interface CloudDeploymentAccessDependencies {
  readonly env?: Readonly<Record<string, string | undefined>>;
  /** The browser sign-in's deploy credential (`hqdp_`, 12 hours). */
  readonly loadCredential?: () => Promise<StoredCloudCredential | null>;
  /** The stored management token (`hqmt_`) for a Cloud origin, or for the latest sign-in. */
  readonly loadManagementCredential?: (
    options: { readonly cloudUrl?: string },
  ) => Promise<StoredManagementCredential | null>;
}

/** Where the credential came from, in precedence order. */
export type CloudCredentialSource = 'env' | 'management-token' | 'login';

export interface ResolvedDeploymentCredential {
  readonly endpoint: string;
  readonly token: string;
  readonly source: CloudCredentialSource;
  readonly tokenKind: CloudTokenKind;
  /** The deployment target the credential names; --project and --environment override it. */
  readonly target?: ProtocolDeploymentReleaseTarget;
  /** The Cloud project slug a stored management token is limited to or names, if any. */
  readonly project?: string;
  /** Only for the browser sign-in's deploy credential. */
  readonly storedCredential?: StoredCloudCredential;
}

function expiredCredential(): CliError {
  return new CliError('CLOUD_CREDENTIAL_EXPIRED', 'The stored Cloud credential has expired. Run `hypequery login` again.', {
    hint: 'Run `hypequery login`.',
    exitClass: 'auth',
  });
}

function notSignedIn(): CliError {
  return new CliError(
    'CLOUD_NOT_SIGNED_IN',
    'Missing deployment credential. Run `hypequery login` (or `hypequery login --device` without a browser), '
      + 'or set HYPEQUERY_API_TOKEN.',
    { hint: 'Run `hypequery login` or `hypequery login --device`, or set HYPEQUERY_API_TOKEN.', exitClass: 'auth' },
  );
}

function storedManagementCredential(
  env: Readonly<Record<string, string | undefined>>,
  dependencies: CloudDeploymentAccessDependencies,
): Promise<StoredManagementCredential | null> {
  const cloudUrl = env.HYPEQUERY_CLOUD_URL ? cloudOriginFromEnv(env) : undefined;
  const load = dependencies.loadManagementCredential
    ?? ((options: { readonly cloudUrl?: string }) => loadManagementCredential(options));
  return load(cloudUrl ? { cloudUrl } : {});
}

/**
 * The one place every Cloud-talking command gets its credential, in this order:
 *
 * 1. `HYPEQUERY_API_TOKEN`. A management token (`hqmt_`) or deploy key
 *    (`hqdp_`) goes to the Cloud origin's deployment endpoint
 *    (`HYPEQUERY_CLOUD_URL`, default https://cloud.hypequery.com) unless
 *    `--endpoint` or `HYPEQUERY_DEPLOYMENT_ENDPOINT` names another. Any other
 *    token needs an explicit endpoint, as before.
 * 2. The stored management token from `hypequery login` or
 *    `hypequery login --device`, for `HYPEQUERY_CLOUD_URL` or the latest
 *    sign-in's origin.
 * 3. The browser sign-in's stored deploy credential.
 *
 * Nothing here prompts or opens a browser, so it runs the same headless.
 */
export async function resolveDeploymentCredential(
  endpointOption: string | undefined,
  dependencies: CloudDeploymentAccessDependencies,
): Promise<ResolvedDeploymentCredential> {
  const env = dependencies.env ?? process.env;
  const explicitEndpoint = endpointOption || env.HYPEQUERY_DEPLOYMENT_ENDPOINT || undefined;
  const envToken = env.HYPEQUERY_API_TOKEN || undefined;

  if (envToken) {
    const tokenKind = cloudTokenKind(envToken);
    if (explicitEndpoint) {
      return { endpoint: explicitEndpoint, token: envToken, source: 'env', tokenKind };
    }
    if (tokenKind === 'unknown') {
      throw new CliError(
        'CLOUD_TOKEN_WITHOUT_ENDPOINT',
        'HYPEQUERY_API_TOKEN is not a hypequery Cloud token (expected a management token, hqmt_…, '
          + 'or a deploy key, hqdp_…), so it requires --endpoint or HYPEQUERY_DEPLOYMENT_ENDPOINT.\n\n'
          + 'If you meant to use `hypequery login`, unset HYPEQUERY_API_TOKEN — '
          + 'the CLI also reads it from a project .env file.',
        { hint: 'Set HYPEQUERY_API_TOKEN to an hqmt_ or hqdp_ token, pass --endpoint, or unset HYPEQUERY_API_TOKEN.' },
      );
    }
    return {
      endpoint: defaultDeploymentEndpoint(cloudOriginFromEnv(env)),
      token: envToken,
      source: 'env',
      tokenKind,
    };
  }
  if (explicitEndpoint) {
    throw new CliError('CLOUD_ENDPOINT_WITHOUT_TOKEN', 'An explicit deployment endpoint requires HYPEQUERY_API_TOKEN.', {
      hint: 'Set HYPEQUERY_API_TOKEN, or drop --endpoint and run `hypequery login`.',
    });
  }

  const management = await storedManagementCredential(env, dependencies);
  if (management) {
    if (Date.parse(management.expiresAt) <= Date.now()) throw expiredCredential();
    return {
      endpoint: management.deploymentEndpoint,
      token: management.token,
      source: 'management-token',
      tokenKind: 'management',
      ...(management.target ? { target: management.target } : {}),
      ...(management.project ? { project: management.project } : {}),
    };
  }

  const credential = await (dependencies.loadCredential ?? loadCloudCredential)();
  if (!credential) throw notSignedIn();
  if (Date.parse(credential.expiresAt) <= Date.now()) throw expiredCredential();
  return {
    endpoint: credential.deploymentEndpoint,
    token: credential.token,
    source: 'login',
    tokenKind: cloudTokenKind(credential.token),
    ...(credential.target ? { target: credential.target } : {}),
    storedCredential: credential,
  };
}

/**
 * The deployment target the stored sign-in names, for commands that write a
 * release without talking to Cloud. Same order as the resolver's stored
 * credentials: a stored management token decides, even when it names none.
 */
export async function storedDeploymentTarget(
  dependencies: CloudDeploymentAccessDependencies,
): Promise<ProtocolDeploymentReleaseTarget | undefined> {
  const management = await storedManagementCredential(dependencies.env ?? process.env, dependencies);
  if (management) return management.target;
  return (await (dependencies.loadCredential ?? loadCloudCredential)())?.target;
}
