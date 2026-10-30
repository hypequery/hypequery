import type { ProtocolDeploymentReleaseTarget } from '@hypequery/protocol';
import { liveUrl, type LiveDeploymentFetch } from './live-deployment.js';

const MAX_CONTRACT_BYTES = 1_048_576;

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
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes.byteLength > MAX_CONTRACT_BYTES) throw new Error('The Cloud client contract exceeds 1 MiB.');
  return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
}
