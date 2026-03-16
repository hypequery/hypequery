/**
 * Dev server for the real node-embedded analytics API.
 *
 * Run with: pnpm dev:server
 *
 *   Dev Tools:  http://localhost:4000/
 *   API Docs:   http://localhost:4000/docs
 *   OpenAPI:    http://localhost:4000/openapi.json
 */
import { serveDev } from '@hypequery/serve';

import { api } from './analytics/api.js';

async function runSampleQueries() {
  const now = new Date();
  const end = now.toISOString().split('T')[0];
  const startDate = new Date(now);
  startDate.setDate(now.getDate() - 28);
  const start = startDate.toISOString().split('T')[0];

  await Promise.all([
    api.run('weeklyRevenue', { input: { start, end } }),
    api.run('passengerStats'),
    api.run('tripsByPassengerCount', { input: { limit: 10 } }),
  ]);
}

async function main() {
  const server = await serveDev(api, {
    port: 4000,
    hostname: 'localhost',
  });

  console.log('\nReal analytics API routes are available through the dev server.');
  console.log('Open the runs UI at http://localhost:4000/.');
  console.log('Running sample queries to seed dev UI stats...');
  await runSampleQueries();
  console.log('\nPress Ctrl+C to stop.\n');

  const shutdown = async () => {
    console.log('\nShutting down...');
    await server.stop();
    process.exit(0);
  };

  (process as NodeJS.Process).on('SIGINT', shutdown);
  (process as NodeJS.Process).on('SIGTERM', shutdown);
}

main().catch((error) => {
  console.error('Failed to start dev server:', error);
  process.exit(1);
});
