/**
 * Asks the demo's session route to sign in as `userId`. Resolves to nothing
 * when the cookie is set, or to a message to show when it isn't: the route
 * refused, or the request never arrived. It never rejects.
 */
export async function requestSignIn(userId: string, fetcher: typeof fetch = fetch): Promise<string | undefined> {
  try {
    const response = await fetcher('/api/session', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ userId }),
    });
    if (response.ok) return undefined;
    const body = (await response.json().catch(() => ({}))) as { error?: unknown };
    return typeof body.error === 'string' ? body.error : `Could not sign in (HTTP ${response.status}).`;
  } catch {
    return 'Could not reach the server. Check your connection and try again.';
  }
}
