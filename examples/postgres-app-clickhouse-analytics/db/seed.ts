import { sql } from 'drizzle-orm';
import { pgdb } from './client.js';
import { accounts } from './schema.js';
import seed from './accounts.seed.json' with { type: 'json' };

const OWNERS = ['Priya Shah', 'Marco Rossi', 'Lena Vogel', 'Sam Okafor', 'Ines Duarte'];
const SEATS: Record<string, number> = { free: 5, starter: 15, growth: 45, enterprise: 150 };

/**
 * Deterministic app data for the 200 seed tenants. The ids, names and plans
 * match `hypequery_examples.tenants`; seats, owner and renewal date exist only
 * in Postgres. Idempotent: safe to run on every start.
 */
export async function seedPostgres(): Promise<number> {
  await pgdb.execute(sql`
    CREATE TABLE IF NOT EXISTS accounts (
      id integer PRIMARY KEY,
      name text NOT NULL,
      plan text NOT NULL,
      seats integer NOT NULL,
      owner text NOT NULL,
      renews_on date NOT NULL
    )`);
  const rows = (seed as Array<[number, string, string]>).map(([id, name, plan]) => ({
    id,
    name,
    plan,
    seats: SEATS[plan] + ((id * 7) % 11),
    owner: OWNERS[id % OWNERS.length],
    renewsOn: new Date(Date.UTC(2026, 10, 1) + ((id * 37) % 365) * 86_400_000).toISOString().slice(0, 10),
  }));
  await pgdb.insert(accounts).values(rows).onConflictDoNothing();
  return rows.length;
}
