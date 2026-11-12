import type { AuthContext } from '@hypequery/serve';

/**
 * Stand-in for your API key store. In production, look the key up by its
 * hash in your database and return the caller it belongs to; never ship keys
 * in source. `API_KEY` overrides the demo key.
 */
// A Map, not a plain object: an object lookup would also match inherited
// names such as "constructor" and let a bogus key through.
const KEYS = new Map<string, AuthContext>([
  [process.env.API_KEY ?? 'demo-key-change-me', { userId: 'demo-client', scopes: ['read:metrics'] }],
]);

export function findApiKey(key: string): AuthContext | null {
  return KEYS.get(key) ?? null;
}
