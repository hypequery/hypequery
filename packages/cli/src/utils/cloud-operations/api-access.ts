import { CliError } from '../cli-error.js';
import {
  resolveDeploymentCredential,
  type CloudCredentialSource,
  type CloudDeploymentAccessDependencies,
} from '../cloud-deployment-access.js';

export interface CloudApiAccess {
  /** Cloud's origin; operations live under `<origin>/v1`. */
  readonly baseUrl: string;
  readonly token: string;
  readonly source: CloudCredentialSource;
  /** The project slug the stored sign-in names: the default for `--project`. */
  readonly defaultProject?: string;
}

const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);

function insecureEndpoint(message: string): CliError {
  return new CliError('CLOUD_ENDPOINT_INSECURE', message, {
    category: 'correctable_input',
    hint: 'Set HYPEQUERY_DEPLOYMENT_ENDPOINT to an https:// URL, or unset it to use hypequery Cloud. '
      + 'HTTP is allowed only for a Cloud running on this machine (localhost).',
  });
}

/**
 * The Cloud origin a credential's deployment endpoint names, refused unless
 * the credential would travel over HTTPS. The endpoint can come from
 * `HYPEQUERY_DEPLOYMENT_ENDPOINT`, so it is checked here, before any
 * operation attaches the token. Loopback HTTP stays allowed for developing
 * against a local Cloud, as it is for deployments.
 */
export function cloudApiOrigin(endpoint: string): string {
  let url: URL;
  try {
    url = new URL(endpoint);
  } catch {
    throw insecureEndpoint('The Cloud endpoint must be an absolute HTTPS URL.');
  }
  const loopbackHttp = url.protocol === 'http:' && LOOPBACK_HOSTS.has(url.hostname);
  if (url.protocol !== 'https:' && !loopbackHttp) {
    throw insecureEndpoint(
      `The Cloud endpoint ${url.origin} does not use HTTPS, so the Cloud credential would be sent unencrypted. `
      + 'Use an https:// endpoint (HTTP is allowed only for a Cloud on localhost).',
    );
  }
  if (url.username || url.password) {
    throw insecureEndpoint('The Cloud endpoint must not carry a username or password.');
  }
  return url.origin;
}

function managementTokenRequired(source: CloudCredentialSource): CliError {
  const found = source === 'env'
    ? 'HYPEQUERY_API_TOKEN is not a management token (hqmt_…)'
    : 'the stored sign-in has only a deploy credential, no management token';
  return new CliError(
    'CLOUD_MANAGEMENT_TOKEN_REQUIRED',
    `Cloud operations need a management token, but ${found}. Deploy keys and deploy credentials work only for deploys.`,
    {
      hint: source === 'env'
        ? 'Set HYPEQUERY_API_TOKEN to a management token (hqmt_…), or unset it and run `hypequery login --device`.'
        : 'Run `hypequery login --device`, or set HYPEQUERY_API_TOKEN to a management token (hqmt_…).',
      exitClass: 'auth',
    },
  );
}

/**
 * The credential and Cloud origin for `/v1` operations, from the one resolver
 * every Cloud command uses (AG-08): HYPEQUERY_API_TOKEN, then the stored
 * management token, then the browser sign-in. A credential is bound to the
 * origin of its deployment endpoint, so that origin is where operations go.
 *
 * `/v1` accepts only management tokens (`hqmt_`): Cloud reads any other
 * bearer as a dashboard session and answers UNAUTHENTICATED. The resolver
 * already puts a stored management token ahead of the browser sign-in's
 * deploy credential, so a deploy credential here means there is no management
 * token to use, and the command stops before sending anything.
 * HYPEQUERY_API_TOKEN is the caller's explicit choice, so a deploy key there
 * is refused rather than silently passed over for a stored sign-in.
 */
export async function resolveCloudApiAccess(
  dependencies: CloudDeploymentAccessDependencies = {},
): Promise<CloudApiAccess> {
  const credential = await resolveDeploymentCredential(undefined, dependencies);
  if (credential.tokenKind !== 'management') throw managementTokenRequired(credential.source);
  return {
    baseUrl: cloudApiOrigin(credential.endpoint),
    token: credential.token,
    source: credential.source,
    ...(credential.project ? { defaultProject: credential.project } : {}),
  };
}
