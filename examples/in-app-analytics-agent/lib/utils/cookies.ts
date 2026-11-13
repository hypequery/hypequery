/** Reads one cookie from a `Cookie` request header. */
export function readCookie(header: string | null, name: string): string | undefined {
  if (!header) return undefined;
  for (const pair of header.split(';')) {
    const [key, ...value] = pair.trim().split('=');
    if (key === name) return decodeURIComponent(value.join('='));
  }
  return undefined;
}
