import type { AgentToken } from '@hypequery/agent';

/** Re-mint this long before the token expires (tokens last at most 15 minutes). */
const REFRESH_MARGIN_MS = 60_000;

/**
 * Mints once now, then hands `hypequeryTools` a token function that re-mints
 * shortly before expiry. Minting is local (no network call), so this is cheap.
 */
export async function refreshingToken(
  mint: () => Promise<AgentToken>,
  now: () => number = Date.now,
): Promise<{ mcpUrl: string; token: () => Promise<string> }> {
  let current = await mint();
  return {
    mcpUrl: current.mcpUrl,
    token: async () => {
      if (current.expiresAt.getTime() - now() < REFRESH_MARGIN_MS) current = await mint();
      return current.token;
    },
  };
}
