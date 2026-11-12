import { closePostgres, usingPglite } from './client.js';
import { seedPostgres } from './seed.js';

/** `pnpm db:seed`: create and fill `accounts` in the Postgres at DATABASE_URL. */
const count = await seedPostgres();
console.log(`seeded ${count} accounts into ${usingPglite ? 'PGlite (in memory, gone on exit)' : 'DATABASE_URL'}`);
await closePostgres();
