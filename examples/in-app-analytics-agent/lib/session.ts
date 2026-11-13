import { findDemoUser, type DemoUser } from './demo-users';
import { readCookie } from './utils/cookies';

/**
 * The demo's "login": a cookie naming one of the demo users. Replace
 * `getSession` with your auth (NextAuth, Clerk, your own session store).
 * What matters is where the tenant comes from: the server-side session,
 * never the request body, a header the browser sets, or the model.
 */
export const SESSION_COOKIE = 'demo_user';

export function getSession(request: Request): DemoUser | null {
  return findDemoUser(readCookie(request.headers.get('cookie'), SESSION_COOKIE)) ?? null;
}
