/**
 * Whether a URL host names this machine. Plain HTTP is allowed only to these
 * hosts, for a gateway run locally; anywhere else a token must travel over
 * HTTPS. `host` is lower case, with an IPv6 address in brackets.
 */
export function isLoopbackHost(host: string): boolean {
  return (
    host === 'localhost' ||
    host.endsWith('.localhost') ||
    host === '127.0.0.1' ||
    host === '[::1]'
  );
}
