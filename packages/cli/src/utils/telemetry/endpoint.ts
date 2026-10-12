/** HTTPS, or HTTP for loopback testing only; rejects credentials, query strings and fragments. */
export function telemetryEndpoint(raw: string | undefined): URL | null {
  if (!raw) return null;
  try {
    const url = new URL(raw);
    const loopback = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
    if ((url.protocol !== 'https:' && !(url.protocol === 'http:' && loopback)) || url.username || url.password || url.search || url.hash) return null;
    return url;
  } catch { return null; }
}
