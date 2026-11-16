import { normalizeCloudOrigin } from './cloud-credential-store.js';

export const DEFAULT_CLOUD_URL = 'https://cloud.hypequery.com';

/** The Cloud origin a command talks to when nothing stored names one. */
export function cloudOriginFromEnv(env: Readonly<Record<string, string | undefined>>): string {
  return normalizeCloudOrigin(env.HYPEQUERY_CLOUD_URL || DEFAULT_CLOUD_URL);
}

/**
 * The deployment protocol endpoint on a Cloud origin, for a credential that
 * didn't come with one (a management token from device sign-in or from
 * `HYPEQUERY_API_TOKEN`). Browser sign-in returns it explicitly and that
 * value wins.
 */
export function defaultDeploymentEndpoint(origin: string): string {
  return new URL('/v1/deployments/submissions', origin).toString();
}
