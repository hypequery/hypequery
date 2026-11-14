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

/**
 * The credential and Cloud origin for `/v1` operations, from the one resolver
 * every Cloud command uses (AG-08): HYPEQUERY_API_TOKEN, then the stored
 * management token, then the browser sign-in. A credential is bound to the
 * origin of its deployment endpoint, so that origin is where operations go.
 */
export async function resolveCloudApiAccess(
  dependencies: CloudDeploymentAccessDependencies = {},
): Promise<CloudApiAccess> {
  const credential = await resolveDeploymentCredential(undefined, dependencies);
  return {
    baseUrl: new URL(credential.endpoint).origin,
    token: credential.token,
    source: credential.source,
    ...(credential.project ? { defaultProject: credential.project } : {}),
  };
}
