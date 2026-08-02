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

function requiredConfiguration(
  value: string | undefined,
  message: string,
): string {
  if (value === undefined || value.length === 0) throw new Error(message);
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
    throw new Error(
      hasExplicitEndpoint
        ? 'An explicit deployment endpoint requires HYPEQUERY_API_TOKEN.'
        : 'HYPEQUERY_API_TOKEN requires --endpoint or HYPEQUERY_DEPLOYMENT_ENDPOINT.\n\n'
          + 'If you meant to use `hypequery login`, unset HYPEQUERY_API_TOKEN — '
          + 'the CLI also reads it from a project .env file.',
    );
  }
  if (!hasExplicitEndpoint) {
    const credential = await (dependencies.loadCredential ?? loadCloudCredential)();
    if (credential) {
      if (Date.parse(credential.expiresAt) <= Date.now()) {
        throw new Error('The stored Cloud credential has expired. Run `hypequery login` again.');
      }
      deploymentEndpoint = credential.deploymentEndpoint;
      token = credential.token;
      storedCredential = credential;
    }
  }
  return {
    endpoint: requiredConfiguration(
      deploymentEndpoint,
      'Missing deployment endpoint. Run `hypequery login`, pass --endpoint, or set HYPEQUERY_DEPLOYMENT_ENDPOINT.',
    ),
    token: requiredConfiguration(
      token,
      'Missing deployment credential. Run `hypequery login` or set HYPEQUERY_API_TOKEN.',
    ),
    ...(storedCredential ? { storedCredential } : {}),
  };
}
