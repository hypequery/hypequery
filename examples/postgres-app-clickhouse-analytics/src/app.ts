import { Hono } from 'hono';
import { serveStatic } from '@hono/node-server/serve-static';
import { listAccountsWithUsage } from './accounts.js';

export const app = new Hono();

/** A plain HTML table over the JSON endpoint. */
app.use('/', serveStatic({ root: './public', path: 'index.html' }));

/**
 * GET /api/accounts?plan=enterprise&since=2026-10-01
 * Postgres accounts enriched with ClickHouse usage, joined by id.
 */
app.get('/api/accounts', async (c) => {
  const plan = c.req.query('plan') || undefined;
  const since = c.req.query('since') || undefined;
  if (since && !/^\d{4}-\d{2}-\d{2}( \d{2}:\d{2}:\d{2})?$/.test(since)) {
    return c.json({ error: 'since must be YYYY-MM-DD or YYYY-MM-DD HH:MM:SS' }, 400);
  }
  const data = await listAccountsWithUsage({ plan, since });
  return c.json({ data });
});
