import { serve } from '@hono/node-server';
import { usingPglite } from '../db/client.js';
import { seedPostgres } from '../db/seed.js';
import { app } from './app.js';

// PGlite is in memory, so seed it on every start. A real Postgres (DATABASE_URL)
// is seeded once with `pnpm db:seed`.
if (usingPglite) await seedPostgres();

const port = Number(process.env.PORT ?? 3000);
serve({ fetch: app.fetch, port }, () => {
  console.log(`accounts (${usingPglite ? 'PGlite' : 'Postgres'}) + usage (ClickHouse) on http://localhost:${port}`);
});
