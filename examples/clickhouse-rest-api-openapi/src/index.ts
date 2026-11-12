import { serve } from '@hono/node-server';
import { app } from './app.js';

const port = Number(process.env.PORT ?? 3000);
serve({ fetch: app.fetch, port }, (info) => {
  console.log(`ClickHouse REST API on http://localhost:${info.port} (docs: /docs, spec: /openapi.json)`);
});
