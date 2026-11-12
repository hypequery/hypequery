import { Hono } from 'hono';
import { createFetchHandler } from '@hypequery/serve';
import { api } from '../analytics/api.js';

const hypequery = createFetchHandler(api.handler);

export const app = new Hono();

/** Your own routes sit beside hypequery's: health checks need no key. */
app.get('/healthz', (c) => c.json({ ok: true }));
app.get('/', (c) => c.redirect('/docs'));

/** /api/*, /openapi.json and /docs are all served by hypequery. */
app.all('*', (c) => hypequery(c.req.raw));
