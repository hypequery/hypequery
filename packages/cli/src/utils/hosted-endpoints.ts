import type { ProtocolDeploymentReleaseTarget } from '@hypequery/protocol';
import { liveUrl, type LiveDeploymentFetch } from './live-deployment.js';

const MAX_RESPONSE_BYTES = 256 * 1024;

/** Where Cloud serves a deployed target. Cloud owns this layout, not the CLI. */
export type HostedEndpoints = {
  readonly active: boolean;
  readonly rest: {
    readonly baseUrl: string;
    readonly datasets: readonly { readonly name: string; readonly url: string }[];
  };
  readonly mcp: { readonly url: string };
};

function httpUrl(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' || url.protocol === 'http:' ? url.toString() : undefined;
  } catch {
    return undefined;
  }
}

export function parseHostedEndpoints(input: unknown): HostedEndpoints | undefined {
  if (typeof input !== 'object' || input === null) return undefined;
  const value = input as Record<string, any>;
  if (value.kind !== 'hypequery-hosted-endpoints' || value.version !== 1) return undefined;
  const baseUrl = httpUrl(value.rest?.baseUrl);
  const mcp = httpUrl(value.mcp?.url);
  if (!baseUrl || !mcp || !Array.isArray(value.rest?.datasets)) return undefined;
  const datasets = [];
  for (const dataset of value.rest.datasets) {
    const url = httpUrl(dataset?.url);
    if (typeof dataset?.name !== 'string' || !url) return undefined;
    datasets.push(Object.freeze({ name: dataset.name, url }));
  }
  return Object.freeze({
    active: value.active === true,
    rest: Object.freeze({ baseUrl, datasets: Object.freeze(datasets) }),
    mcp: Object.freeze({ url: mcp }),
  });
}

/**
 * Asks Cloud where the target is served. Never throws: the deployment has
 * already succeeded, so an older Cloud (404), a network failure, or an
 * unexpected response just means there is nothing to print.
 */
export async function fetchHostedEndpoints(input: {
  readonly endpoint: string;
  readonly token: string;
  readonly target: ProtocolDeploymentReleaseTarget;
  readonly fetch?: LiveDeploymentFetch;
}): Promise<HostedEndpoints | undefined> {
  try {
    const url = liveUrl(input.endpoint, input.target, 'endpoints');
    if (!url) return undefined;
    const response = await (input.fetch ?? fetch)(url, {
      method: 'GET',
      headers: { Accept: 'application/json', Authorization: `Bearer ${input.token}` },
      redirect: 'error',
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) return undefined;
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (bytes.byteLength > MAX_RESPONSE_BYTES) return undefined;
    return parseHostedEndpoints(JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)));
  } catch {
    return undefined;
  }
}

/** The environment variable generated configuration reads the key from. */
export const MCP_API_KEY_VARIABLE = 'HYPEQUERY_API_KEY';

/**
 * Client configuration for the hosted MCP endpoint. The key is a placeholder
 * the client expands from its environment: the CLI never writes a credential
 * into anything it prints.
 */
export function mcpClientConfiguration(mcpUrl: string): string {
  return JSON.stringify(
    {
      mcpServers: {
        hypequery: {
          type: 'http',
          url: mcpUrl,
          headers: { Authorization: `Bearer \${${MCP_API_KEY_VARIABLE}}` },
        },
      },
    },
    null,
    2,
  );
}
