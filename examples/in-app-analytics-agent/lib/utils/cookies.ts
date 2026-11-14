/** Reads one cookie from a `Cookie` request header. */
export function readCookie(header: string | null, name: string): string | undefined {
  if (!header) return undefined;
  for (const pair of header.split(';')) {
    const [key, ...value] = pair.trim().split('=');
    if (key !== name) continue;
    try {
      return decodeURIComponent(value.join('='));
    } catch {
      // A malformed escape (`%E0%A4`) is no session, not a server error.
      return undefined;
    }
  }
  return undefined;
}
