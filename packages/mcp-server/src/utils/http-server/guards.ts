/**
 * DNS-rebinding protection for the self-hosted HTTP transport.
 *
 * A browser tricked into resolving an attacker's name to a loopback or private
 * address still sends the attacker's name as `Host`, and a page script sends its
 * own `Origin`. Checking both before anything else keeps a local MCP server from
 * answering a hostile page.
 */

/** Loopback names allowed when no explicit host list is configured. */
export const DEFAULT_ALLOWED_HOSTS: readonly string[] = Object.freeze(['localhost', '127.0.0.1', '[::1]']);

/** Lower-cased host names, without ports, for allow-list comparison. */
export function normalizeAllowedHosts(hosts: readonly string[] | undefined): ReadonlySet<string> {
  const values = hosts ?? DEFAULT_ALLOWED_HOSTS;
  const normalized = new Set<string>();
  for (const host of values) {
    if (typeof host !== 'string' || host.trim() === '') {
      throw new TypeError('allowedHosts entries must be non-empty host names.');
    }
    normalized.add(hostName(host.trim()));
  }
  if (normalized.size === 0) {
    throw new TypeError('allowedHosts must name at least one host.');
  }
  return normalized;
}

/** Exact origins (scheme, host and port) a browser page may call from. */
export function normalizeAllowedOrigins(origins: readonly string[] | undefined): ReadonlySet<string> {
  const normalized = new Set<string>();
  for (const origin of origins ?? []) {
    let parsed: URL;
    try {
      parsed = new URL(origin);
    } catch {
      throw new TypeError(`allowedOrigins entry is not a URL origin: ${JSON.stringify(origin)}`);
    }
    if (parsed.origin === 'null' || parsed.origin !== origin.replace(/\/$/, '')) {
      throw new TypeError(`allowedOrigins entries must be bare origins such as https://app.example.com: ${JSON.stringify(origin)}`);
    }
    normalized.add(parsed.origin);
  }
  return normalized;
}

/** The host name of a `Host` header value, lower-cased and without its port. */
export function hostName(value: string): string {
  const host = value.trim().toLowerCase();
  if (host.startsWith('[')) {
    const end = host.indexOf(']');
    return end === -1 ? host : host.slice(0, end + 1);
  }
  const colon = host.indexOf(':');
  return colon === -1 ? host : host.slice(0, colon);
}

export function hostAllowed(host: string | null, allowed: ReadonlySet<string>): boolean {
  return host !== null && host !== '' && allowed.has(hostName(host));
}

/** A request without `Origin` is an ordinary MCP client; one with it must be listed. */
export function originAllowed(origin: string | null, allowed: ReadonlySet<string>): boolean {
  return origin === null || allowed.has(origin);
}
