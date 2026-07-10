/**
 * Returns enough endpoint information for diagnostics without exposing URL
 * userinfo, query parameters, or fragments that may contain credentials.
 */
export function redactConnectionUrl(value: string | undefined): string {
  if (!value) return 'not set';

  const trimmed = value.trim();
  const hasScheme = /^[a-z][a-z\d+.-]*:\/\//i.test(trimmed);

  try {
    const url = new URL(hasScheme ? trimmed : `http://${trimmed}`);
    const pathname = url.pathname === '/' ? '' : url.pathname;
    return `${hasScheme ? `${url.protocol}//` : ''}${url.host}${pathname}`;
  } catch {
    return '[configured connection URL]';
  }
}
