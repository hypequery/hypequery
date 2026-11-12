import { Hono } from 'hono';
import { createFetchHandler } from '@hypequery/serve';
import { api } from '../analytics/api.js';

const hypequery = createFetchHandler(api.handler);

export const app = new Hono();

app.get('/health', (c) => c.json({ ok: true }));

/** Everything under /api/billing is hypequery: auth, tenant scoping, validation, OpenAPI. */
app.all('/api/billing/*', (c) => hypequery(c.req.raw));
