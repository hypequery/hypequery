import { DEMO_USERS, findDemoUser } from '@/lib/demo-users';
import { SESSION_COOKIE } from '@/lib/session';

/**
 * The demo's sign-in: pick a demo user and get a session cookie. Your app
 * already has this; the chat route only needs to read the session.
 */
export async function POST(request: Request) {
  const { userId } = (await request.json().catch(() => ({}))) as { userId?: string };
  const user = findDemoUser(userId);
  if (!user) {
    return Response.json({ error: `Unknown demo user. Use one of: ${DEMO_USERS.map((u) => u.id).join(', ')}.` }, { status: 400 });
  }
  const response = Response.json({ id: user.id, name: user.name, tenantName: user.tenantName });
  response.headers.set('set-cookie', `${SESSION_COOKIE}=${encodeURIComponent(user.id)}; Path=/; HttpOnly; SameSite=Lax`);
  return response;
}
