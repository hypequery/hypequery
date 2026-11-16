import type { ProtocolDeploymentReleaseTarget } from '@hypequery/protocol';
import { CliError } from './cli-error.js';
import {
  loadCloudCredential,
  type StoredCloudCredential,
} from './cloud-credential-store.js';
import { cloudOriginFromEnv, DEFAULT_CLOUD_URL, defaultDeploymentEndpoint } from './cloud-origin.js';
import { cloudTokenKind, type CloudTokenKind } from './cloud-token-kind.js';
import { envFileVariableNames } from './env-provenance.js';
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
  /**
   * Names a project `.env*` file set rather than the process environment.
   * Defaults to what `bin/cli.ts` recorded before loading env files.
   */
  readonly envFileVariables?: ReadonlySet<string>;
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

/**
 * `HYPEQUERY_API_TOKEN` from the shell must not go to a server that a project
 * `.env` file named: a cloned repository could otherwise collect the token of
 * whoever runs a command in it. A token and destination that both come from
 * env files are the project's own configuration and are allowed, as are a
 * destination from the shell or `--endpoint`.
 */
function refuseEnvFileDestination(
  variable: 'HYPEQUERY_CLOUD_URL' | 'HYPEQUERY_DEPLOYMENT_ENDPOINT',
  envFileVariables: ReadonlySet<string>,
): void {
  if (!envFileVariables.has(variable) || envFileVariables.has('HYPEQUERY_API_TOKEN')) return;
  throw new CliError(
    'CLOUD_URL_FROM_ENV_FILE',
    `${variable} comes from a .env file in this directory, but HYPEQUERY_API_TOKEN comes from your shell. `
      + `The CLI does not send a token from your shell to a server a project file names. `
      + `Set ${variable} in your shell (for example \`export ${variable}=…\`) or pass --endpoint, `
      + `or remove ${variable} from the .env file.`,
    {
      hint: `Set ${variable} in your shell instead of a .env file, or remove it from the .env file.`,
      exitClass: 'auth',
    },
  );
}

/**
 * A management token (`hqmt_`) acts on the whole organisation, so it only goes
 * to its own Cloud origin: `HYPEQUERY_CLOUD_URL` (default
 * https://cloud.hypequery.com). `--endpoint` or `HYPEQUERY_DEPLOYMENT_ENDPOINT`
 * may name another path on that origin, but not another host; a prompt-injected
 * agent could otherwise send the token anywhere with
 * `deployment status --endpoint https://…`. Deploy keys (`hqdp_`) are limited
 * to deployments and may still go to any endpoint.
 */
function refuseManagementTokenElsewhere(
  endpoint: string,
  env: Readonly<Record<string, string | undefined>>,
  envFileVariables: ReadonlySet<string>,
): void {
  // A Cloud URL from a .env file names the token's Cloud only when the token
  // came from an env file too; otherwise the default Cloud is the token's.
  const fileChoseOrigin = envFileVariables.has('HYPEQUERY_CLOUD_URL') && !envFileVariables.has('HYPEQUERY_API_TOKEN');
  const origin = fileChoseOrigin ? DEFAULT_CLOUD_URL : cloudOriginFromEnv(env);
  let endpointOrigin: string | undefined;
  try {
    endpointOrigin = new URL(endpoint).origin;
  } catch {
    endpointOrigin = undefined;
  }
  if (endpointOrigin === origin) return;
  throw new CliError(
    'MANAGEMENT_TOKEN_ENDPOINT_MISMATCH',
    `HYPEQUERY_API_TOKEN is a management token for ${origin}, and the CLI only sends it to that Cloud, `
      + `not to the endpoint ${endpointOrigin ?? endpoint}. `
      + 'Drop --endpoint (and HYPEQUERY_DEPLOYMENT_ENDPOINT), set HYPEQUERY_CLOUD_URL in your shell to the '
      + 'Cloud that issued the token, or use a deploy key (hqdp_…) for a custom endpoint.',
    {
      hint: 'Drop --endpoint, set HYPEQUERY_CLOUD_URL to the Cloud that issued the token, or use a deploy key.',
      exitClass: 'auth',
      category: 'forbidden',
    },
  );
}

/** The Cloud origin `HYPEQUERY_CLOUD_URL` names, when it is set. */
function requestedOrigin(env: Readonly<Record<string, string | undefined>>): string | undefined {
  return env.HYPEQUERY_CLOUD_URL ? cloudOriginFromEnv(env) : undefined;
}

function storedManagementCredential(
  env: Readonly<Record<string, string | undefined>>,
  dependencies: CloudDeploymentAccessDependencies,
): Promise<StoredManagementCredential | null> {
  const cloudUrl = requestedOrigin(env);
  const load = dependencies.loadManagementCredential
    ?? ((options: { readonly cloudUrl?: string }) => loadManagementCredential(options));
  return load(cloudUrl ? { cloudUrl } : {});
}

/**
 * The browser sign-in's deploy credential, unless `HYPEQUERY_CLOUD_URL` names
 * a different Cloud than the one it was issued by: a command told to use one
 * Cloud must not quietly act on another.
 */
async function storedDeployCredential(
  env: Readonly<Record<string, string | undefined>>,
  dependencies: CloudDeploymentAccessDependencies,
): Promise<StoredCloudCredential | null> {
  const credential = await (dependencies.loadCredential ?? loadCloudCredential)();
  const origin = requestedOrigin(env);
  if (credential && origin !== undefined && credential.cloudUrl !== origin) {
    throw new CliError(
      'CLOUD_NOT_SIGNED_IN',
      `HYPEQUERY_CLOUD_URL is ${origin}, but the stored sign-in is for ${credential.cloudUrl}. `
        + `Run \`hypequery login\` to sign in to ${origin}, or unset HYPEQUERY_CLOUD_URL.`,
      { hint: 'Run `hypequery login` for the Cloud HYPEQUERY_CLOUD_URL names, or unset HYPEQUERY_CLOUD_URL.', exitClass: 'auth' },
    );
  }
  return credential;
}

/**
 * The one place every Cloud-talking command gets its credential, in this order:
 *
 * 1. `HYPEQUERY_API_TOKEN`. A management token (`hqmt_`) or deploy key
 *    (`hqdp_`) goes to the Cloud origin's deployment endpoint
 *    (`HYPEQUERY_CLOUD_URL`, default https://cloud.hypequery.com) unless
 *    `--endpoint` or `HYPEQUERY_DEPLOYMENT_ENDPOINT` names another. A
 *    management token's explicit endpoint must be on that Cloud origin; a
 *    deploy key's may be anywhere. Any other token needs an explicit
 *    endpoint, as before.
 * 2. The stored management token from `hypequery login` or
 *    `hypequery login --device`, for `HYPEQUERY_CLOUD_URL` or the latest
 *    sign-in's origin.
 * 3. The browser sign-in's stored deploy credential, when it is for
 *    `HYPEQUERY_CLOUD_URL` or that is unset.
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
    const envFileVariables = dependencies.envFileVariables ?? envFileVariableNames();
    if (!endpointOption && env.HYPEQUERY_DEPLOYMENT_ENDPOINT) {
      refuseEnvFileDestination('HYPEQUERY_DEPLOYMENT_ENDPOINT', envFileVariables);
    }
    if (explicitEndpoint) {
      if (tokenKind === 'management') refuseManagementTokenElsewhere(explicitEndpoint, env, envFileVariables);
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
    if (env.HYPEQUERY_CLOUD_URL) refuseEnvFileDestination('HYPEQUERY_CLOUD_URL', envFileVariables);
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

  const credential = await storedDeployCredential(env, dependencies);
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
  const env = dependencies.env ?? process.env;
  const management = await storedManagementCredential(env, dependencies);
  if (management) return management.target;
  return (await storedDeployCredential(env, dependencies))?.target;
}
