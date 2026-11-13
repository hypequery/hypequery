import { AgentTokenError } from './errors.js';

/**
 * The project's tenant MCP URL, from its customer endpoint as Cloud shows it:
 * the origin (`https://<endpoint>.hypequery.app`) or the MCP URL itself. The
 * endpoint's name is not derivable from the project or the key, so it is
 * given, never looked up: minting makes no network call.
 *
 * Parsed by pattern rather than `URL`, so Python's `mint_agent_token()`
 * resolves every input to the same URL or refuses the same inputs.
 */
const ENDPOINT_PATTERN =
  /^(https?):\/\/([A-Za-z0-9.-]+|\[::1\])(?::([0-9]{1,5}))?(\/|\/mcp)?$/;
const LABEL_PATTERN = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;
const DEFAULT_PORTS: Record<string, string> = { https: '443', http: '80' };

function refuse(message: string): never {
  throw new AgentTokenError('endpoint', message);
}

/** Plain HTTP only reaches a gateway on this machine. */
function isLoopback(host: string): boolean {
  return (
    host === 'localhost' ||
    host.endsWith('.localhost') ||
    host === '127.0.0.1' ||
    host === '[::1]'
  );
}

export function resolveMcpUrl(endpoint: unknown): string {
  if (typeof endpoint !== 'string') {
    refuse('endpoint must be the project\'s customer endpoint URL from Cloud.');
  }
  const match = ENDPOINT_PATTERN.exec(endpoint);
  if (!match) {
    refuse(
      'endpoint must be the project\'s customer endpoint, for example ' +
        '"https://acme-logistics-1f2e3d.hypequery.app", or its "/mcp" URL.',
    );
  }
  const scheme = match[1]!;
  const host = match[2]!.toLowerCase();
  const port = match[3];
  const validHost =
    host === '[::1]' ||
    (host.length <= 253 && host.split('.').every((label) => LABEL_PATTERN.test(label)));
  if (!validHost) refuse('endpoint has an invalid host name.');
  if (scheme === 'http' && !isLoopback(host)) {
    refuse('endpoint must use https (plain http is allowed for localhost only).');
  }
  let authority = host;
  if (port !== undefined) {
    const number = Number(port);
    if (number < 1 || number > 65_535) refuse('endpoint has an invalid port.');
    if (String(number) !== DEFAULT_PORTS[scheme]) authority = `${host}:${number}`;
  }
  return `${scheme}://${authority}/mcp`;
}
