import { asc, eq } from 'drizzle-orm';
import { gte, inList } from '@hypequery/datasets';
import { pgdb } from '../db/client.js';
import { accounts, type Account } from '../db/schema.js';
import { analytics } from '../analytics/client.js';
import { Usage } from '../analytics/datasets.js';

/** The seed's last 30 days. In your app: a rolling `now() - 30 days`. */
export const DEFAULT_SINCE = '2026-10-01 00:00:00';

export interface AccountWithUsage extends Account {
  events: number;
  activeUsers: number;
  /** Active users in the window / seats bought. The number neither DB has alone. */
  seatUtilization: number;
  lastSeenAt: string | null;
}

/**
 * 1. Postgres (Drizzle): the accounts this screen shows, with app-owned fields.
 * 2. ClickHouse (hypequery): usage for exactly those ids, one grouped query.
 * 3. Join in the app by id. No cross-database SQL, no N+1.
 */
export async function listAccountsWithUsage(opts: { plan?: string; since?: string } = {}): Promise<AccountWithUsage[]> {
  const rows = await pgdb
    .select()
    .from(accounts)
    .where(opts.plan ? eq(accounts.plan, opts.plan) : undefined)
    .orderBy(asc(accounts.id));
  if (rows.length === 0) return [];

  const usage = await analytics.execute(Usage, {
    dimensions: ['tenantId'],
    measures: ['events', 'activeUsers', 'lastSeenAt'],
    filters: [inList('tenantId', rows.map((a) => a.id)), gte('occurredAt', opts.since ?? DEFAULT_SINCE)],
    limit: rows.length,
  });
  const byId = new Map(usage.data.map((u) => [Number(u.tenantId), u]));

  return rows.map((account) => {
    const u = byId.get(account.id);
    const activeUsers = Number(u?.activeUsers ?? 0);
    return {
      ...account,
      events: Number(u?.events ?? 0),
      activeUsers,
      seatUtilization: Math.round((activeUsers / account.seats) * 100) / 100,
      lastSeenAt: u?.lastSeenAt ? String(u.lastSeenAt) : null,
    };
  });
}
