const REQUEST_TIMEOUT_MS = 30_000;

export interface RevokeCloudTokenDependencies {
  readonly fetch?: typeof fetch;
  readonly requestTimeoutMs?: number;
}

/**
 * Asks the Cloud that issued `token` to revoke it (`DELETE /api/cli/token`,
 * which takes a deploy credential or a management token). Best effort: false
 * when Cloud can't be reached or refuses, and the token then simply expires.
 */
export async function revokeCloudToken(
  cloudUrl: string,
  token: string,
  dependencies: RevokeCloudTokenDependencies = {},
): Promise<boolean> {
  try {
    const request = dependencies.fetch ?? fetch;
    const response = await request(new URL('/api/cli/token', cloudUrl), {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${token}` },
      redirect: 'error',
      signal: AbortSignal.timeout(dependencies.requestTimeoutMs ?? REQUEST_TIMEOUT_MS),
    });
    await response.body?.cancel().catch(() => undefined);
    return response.ok;
  } catch {
    return false;
  }
}
