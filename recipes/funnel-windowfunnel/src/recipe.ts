import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { between, type DatasetQueryFor } from '@hypequery/datasets';
import { analytics, db } from './client.js';
import { Funnel } from './dataset.js';

/** October 2026, the seed's last full month; fixed so the output is reproducible. */
export const MONTH: [string, string] = ['2026-10-01 00:00:00', '2026-10-31 23:59:59'];

/**
 * The question: for the ten tenants with the most logged-in users in
 * October, how many went login -> query_run -> export within 24 hours, and
 * what is the conversion at each step?
 */
export const query = {
  dimensions: ['tenantId'],
  measures: ['loggedIn', 'ranQuery', 'exported', 'queryRate', 'exportRate', 'conversion'],
  filters: [between('month', MONTH[0], MONTH[1])],
  orderBy: [
    { field: 'loggedIn', direction: 'desc' },
    { field: 'tenantId', direction: 'asc' },
  ],
  limit: 10,
} satisfies DatasetQueryFor<typeof Funnel>;

export function toSQL(): string {
  return analytics.toSQL(Funnel, query);
}

export async function run() {
  const result = await analytics.execute(Funnel, query);
  return result.data;
}

/** The same funnel over every tenant: one row, the headline numbers. */
export async function overall() {
  const result = await analytics.execute(Funnel, { ...query, dimensions: [], orderBy: [], limit: undefined });
  return result.data[0];
}

export interface ModeRow {
  mode: string;
  input: 'all events' | 'funnel events only';
  loggedIn: string;
  ranQuery: string;
  exported: string;
}

/**
 * The escape hatch: compare windowFunnel's modes with a typed raw query. The
 * mode is a parameter of the aggregate itself, which a dataset measure cannot
 * express, so this part is plain SQL through the same client.
 */
export async function compareModes(): Promise<ModeRow[]> {
  const modes = ['', 'strict_order', 'strict_deduplication', 'strict_increase', 'strict_once'];
  const inputs = [
    ['all events', ''],
    ['funnel events only', "AND event_type IN ('login', 'query_run', 'export')"],
  ] as const;
  const rows: ModeRow[] = [];
  for (const [input, filter] of inputs) {
    for (const mode of modes) {
      const params = mode ? `86400, '${mode}'` : '86400';
      const [row] = await db.rawQuery<Omit<ModeRow, 'mode' | 'input'>>(
        `SELECT countIf(level >= 1) AS loggedIn, countIf(level >= 2) AS ranQuery, countIf(level >= 3) AS exported
         FROM (
           SELECT windowFunnel(${params})(occurred_at, event_type = 'login', event_type = 'query_run', event_type = 'export') AS level
           FROM events
           WHERE occurred_at BETWEEN ? AND ? ${filter}
           GROUP BY tenant_id, user_id
         )`,
        [MONTH[0], MONTH[1]],
      );
      rows.push({ mode: mode || 'default', input, ...row });
    }
  }
  return rows;
}

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const isMain = process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href;
if (isMain) {
  run()
    .then(async (rows) => {
      if (process.argv.includes('--write')) {
        // Capture the artifacts shown on the recipe page and asserted in CI.
        fs.writeFileSync(path.join(root, 'expected.sql'), `${toSQL()}\n`);
        fs.writeFileSync(path.join(root, 'output.json'), `${JSON.stringify(rows, null, 2)}\n`);
        console.log('wrote expected.sql and output.json');
      } else if (process.argv.includes('--json')) {
        console.log(JSON.stringify(rows, null, 2));
      } else {
        console.log(`login -> query_run -> export within 24h, top tenants, ${MONTH[0].slice(0, 7)}\n`);
        console.table(rows);
        console.log('\nAll tenants:');
        console.table([await overall()]);
        console.log('\nwindowFunnel modes, all tenants:');
        console.table(await compareModes());
        console.log('\nGenerated SQL:\n' + toSQL());
      }
      await db.close();
    })
    .catch(async (error) => {
      console.error(error instanceof Error ? error.message : error);
      await db.close();
      process.exit(1);
    });
}
