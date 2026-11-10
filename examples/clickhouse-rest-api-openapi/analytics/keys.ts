import type { AuthContext } from '@hypequery/serve';

/**
 * Stand-in for your API key store. In production, look the key up by its
 * hash in your database and return the caller it belongs to; never ship keys
 * in source. `API_KEY` overrides the demo key.
 */
const KEYS: Record<string, AuthContext> = {
  [process.env.API_KEY ?? 'demo-key-change-me']: { userId: 'demo-client', scopes: ['read:metrics'] },
};

export function findApiKey(key: string): AuthContext | null {
  return KEYS[key] ?? null;
}
