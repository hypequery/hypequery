import { isLoopbackHost } from '../utils/loopback.js';

/**
 * The tenant MCP endpoint a tools client sends its bearer token to. Refused
 * unless the token would travel over HTTPS, the same rule `mintAgentToken()`
 * applies to the endpoint it mints for: plain HTTP is allowed only to this
 * machine, for a gateway run locally.
 */
export function toolsEndpointUrl(input: string | URL): URL {
  let url: URL;
  try {
    url = new URL(input);
  } catch {
    throw new TypeError(
      'hypequeryTools: url must be the tenant MCP endpoint, for example "https://<endpoint>.hypequery.app/mcp".',
    );
  }
  const localHttp = url.protocol === 'http:' && isLoopbackHost(url.hostname);
  if (url.protocol !== 'https:' && !localHttp) {
    throw new TypeError(
      'hypequeryTools: url must use https, so the token is not sent unencrypted '
      + '(plain http is allowed for localhost only).',
    );
  }
  return url;
}
