/**
 * True for hostnames that only resolve to the visitor's own machine. Analytics
 * stays off there so local development never pollutes production metrics.
 */
export function isLocalHostname(hostname: string): boolean {
  const host = hostname.toLowerCase();
  return (
    host === 'localhost'
    || host.endsWith('.localhost')
    || host === '127.0.0.1'
    || host === '0.0.0.0'
    || host === '::1'
    || host === '[::1]'
  );
}
