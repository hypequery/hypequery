import { Hono } from 'hono';
import { serveStatic } from '@hono/node-server/serve-static';
import { createFetchHandler } from '@hypequery/serve';
import { api, issueAnalyticsToken } from '../analytics/api.js';
import { DEMO_USERS, findDemoUser } from './users.js';

const hypequery = createFetchHandler(api.handler);

export const app = new Hono();

/** The embeddable widget (plain HTML + fetch, no framework). */
app.use('/', serveStatic({ root: './public', path: 'index.html' }));
app.use('/embed.js', serveStatic({ root: './public', path: 'embed.js' }));

/** Demo only: lets the widget pick a user. A real app has a login. */
app.get('/api/demo-users', (c) => c.json(DEMO_USERS.map(({ email, name, tenantName }) => ({ email, name, tenantName }))));

/**
 * Your server mints the token. Here the "session" is the email in the body;
 * in your app it is the authenticated user. Nothing tenant-related comes
 * from the client.
 */
app.post('/api/analytics/token', async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as { email?: string };
  const user = body.email ? findDemoUser(body.email) : undefined;
  if (!user) return c.json({ error: 'unknown user' }, 401);
  const token = await issueAnalyticsToken({
    userId: user.email,
    tenantId: String(user.tenantId),
    roles: user.roles,
    scopes: ['read:analytics'],
  });
  return c.json({ token, expiresIn: 900 });
});

/** Everything else under /api/analytics is hypequery. */
app.all('/api/analytics/*', (c) => hypequery(c.req.raw));
