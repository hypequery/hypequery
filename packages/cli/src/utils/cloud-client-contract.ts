import type { ProtocolDeploymentReleaseTarget } from '@hypequery/protocol';
import { liveUrl, type LiveDeploymentFetch } from './live-deployment.js';
import { readCapped } from './read-capped.js';

const MAX_CONTRACT_BYTES = 1_048_576;

const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);

/**
 * The origin a generated client calls. Refused when Cloud did not say, when it
 * is not https (loopback aside), or when it carries a path: the client resolves
 * its absolute endpoint paths against the origin, so a prefix would be dropped.
 */
export function clientOrigin(baseUrl: string | undefined): string {
  if (baseUrl === undefined) {
    throw new Error('Cloud did not say where this release is served, so the client would have no base URL. Retry, or update Cloud.');
  }
  const url = new URL(baseUrl);
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && LOOPBACK_HOSTS.has(url.hostname))) {
    throw new Error(`Cloud serves this release from ${url.origin}, which is not https.`);
  }
  if (url.pathname !== '/' || url.search || url.hash) {
    throw new Error(
      `Cloud serves this release under ${baseUrl} because an endpoint path collides with a reserved Cloud path (such as /mcp). `
      + 'Rename that endpoint path and deploy again; generated clients call the customer origin directly.',
    );
  }
  return url.origin;
}

/**
 * The client contract of the target's live release, as Cloud serves it beside
 * the deployment endpoint. Returned as text: the caller decodes and verifies it
 * exactly as it would a contract file.
 */
export async function fetchCloudClientContract(input: {
  readonly endpoint: string;
  readonly token: string;
  readonly target: ProtocolDeploymentReleaseTarget;
  readonly fetch?: LiveDeploymentFetch;
}): Promise<string> {
  const url = liveUrl(input.endpoint, input.target, 'client-contract');
  if (!url) {
    throw new Error('The deployment endpoint is not a Cloud submissions URL, so it serves no client contract.');
  }
  const response = await (input.fetch ?? fetch)(url, {
    method: 'GET',
    headers: { Accept: 'application/json', Authorization: `Bearer ${input.token}` },
    redirect: 'error',
    signal: AbortSignal.timeout(30_000),
  });
  const target = `${input.target.project} / ${input.target.environment}`;
  if (response.status === 401 || response.status === 403) {
    throw new Error(`Cloud refused the client contract for ${target}. Run \`hypequery login\` again.`);
  }
  if (response.status === 404) {
    throw new Error(
      `Cloud has no client contract for ${target}: publish a release first, `
      + 'or this Cloud version does not serve client contracts yet.',
    );
  }
  if (!response.ok) {
    throw new Error(`Cloud could not return the client contract for ${target} (HTTP ${response.status}).`);
  }
  return new TextDecoder('utf-8', { fatal: true }).decode(await readCapped(response, MAX_CONTRACT_BYTES));
}
