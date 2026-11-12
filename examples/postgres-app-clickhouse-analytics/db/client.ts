import { PGlite } from '@electric-sql/pglite';
import { drizzle as drizzlePglite } from 'drizzle-orm/pglite';
import { drizzle as drizzleNodePg } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import * as schema from './schema.js';

/**
 * Your existing Postgres + Drizzle setup. With DATABASE_URL set it talks to a
 * real Postgres; without it, PGlite runs Postgres in-process (in memory) so
 * the example needs no database server besides ClickHouse.
 */
export const usingPglite = !process.env.DATABASE_URL;

const pool = usingPglite ? undefined : new pg.Pool({ connectionString: process.env.DATABASE_URL });
const pglite = usingPglite ? new PGlite() : undefined;

// Both drivers expose the same query API; one type keeps the app driver-agnostic.
export const pgdb = (pool ? drizzleNodePg(pool, { schema }) : drizzlePglite(pglite!, { schema })) as ReturnType<
  typeof drizzleNodePg<typeof schema>
>;

export async function closePostgres(): Promise<void> {
  await pool?.end();
  await pglite?.close();
}
