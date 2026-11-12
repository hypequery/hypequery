import { CliError } from './cli-error.js';
import {
  loadCloudCredential,
  type StoredCloudCredential,
} from './cloud-credential-store.js';

export interface CloudDeploymentAccessDependencies {
  readonly env?: Readonly<Record<string, string | undefined>>;
  readonly loadCredential?: () => Promise<StoredCloudCredential | null>;
}

export interface ResolvedDeploymentCredential {
  readonly endpoint: string;
  readonly token: string;
  readonly storedCredential?: StoredCloudCredential;
}

function requiredConfiguration(value: string | undefined, error: CliError): string {
  if (value === undefined || value.length === 0) throw error;
  return value;
}

export async function resolveDeploymentCredential(
  endpointOption: string | undefined,
  dependencies: CloudDeploymentAccessDependencies,
): Promise<ResolvedDeploymentCredential> {
  const env = dependencies.env ?? process.env;
  let deploymentEndpoint = endpointOption ?? env.HYPEQUERY_DEPLOYMENT_ENDPOINT;
  let token = env.HYPEQUERY_API_TOKEN;
  let storedCredential: StoredCloudCredential | undefined;
  const hasExplicitEndpoint = Boolean(deploymentEndpoint);
  const hasExplicitToken = Boolean(token);
  if (hasExplicitEndpoint !== hasExplicitToken) {
    throw hasExplicitEndpoint
      ? new CliError('CLOUD_ENDPOINT_WITHOUT_TOKEN', 'An explicit deployment endpoint requires HYPEQUERY_API_TOKEN.', {
        hint: 'Set HYPEQUERY_API_TOKEN, or drop --endpoint and run `hypequery login`.',
      })
      : new CliError(
        'CLOUD_TOKEN_WITHOUT_ENDPOINT',
        'HYPEQUERY_API_TOKEN requires --endpoint or HYPEQUERY_DEPLOYMENT_ENDPOINT.\n\n'
          + 'If you meant to use `hypequery login`, unset HYPEQUERY_API_TOKEN — '
          + 'the CLI also reads it from a project .env file.',
        { hint: 'Pass --endpoint or set HYPEQUERY_DEPLOYMENT_ENDPOINT, or unset HYPEQUERY_API_TOKEN.' },
      );
  }
  if (!hasExplicitEndpoint) {
    const credential = await (dependencies.loadCredential ?? loadCloudCredential)();
    if (credential) {
      if (Date.parse(credential.expiresAt) <= Date.now()) {
        throw new CliError('CLOUD_CREDENTIAL_EXPIRED', 'The stored Cloud credential has expired. Run `hypequery login` again.', {
          hint: 'Run `hypequery login`.',
          exitClass: 'auth',
        });
      }
      deploymentEndpoint = credential.deploymentEndpoint;
      token = credential.token;
      storedCredential = credential;
    }
  }
  return {
    endpoint: requiredConfiguration(
      deploymentEndpoint,
      new CliError(
        'CLOUD_NOT_SIGNED_IN',
        'Missing deployment endpoint. Run `hypequery login`, pass --endpoint, or set HYPEQUERY_DEPLOYMENT_ENDPOINT.',
        { hint: 'Run `hypequery login`, or set HYPEQUERY_API_TOKEN with --endpoint.', exitClass: 'auth' },
      ),
    ),
    token: requiredConfiguration(
      token,
      new CliError(
        'CLOUD_NOT_SIGNED_IN',
        'Missing deployment credential. Run `hypequery login` or set HYPEQUERY_API_TOKEN.',
        { hint: 'Run `hypequery login`, or set HYPEQUERY_API_TOKEN with --endpoint.', exitClass: 'auth' },
      ),
    ),
    ...(storedCredential ? { storedCredential } : {}),
  };
}
