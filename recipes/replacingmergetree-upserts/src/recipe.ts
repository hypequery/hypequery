import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { DatasetQueryFor } from '@hypequery/datasets';
import { analytics, db } from './client.js';
import { Tenants, TenantsLatest, TenantVersions } from './dataset.js';
import { optimize } from './setup.js';

/** The question: how many live tenants are on each plan, after every upsert and delete? */
export const query = {
  dimensions: ['plan'],
  measures: ['tenants'],
  orderBy: [{ field: 'plan', direction: 'asc' }],
} satisfies DatasetQueryFor<typeof Tenants>;

export function toSQL(): string {
  return analytics.toSQL(Tenants, query);
}

export async function run() {
  const result = await analytics.execute(Tenants, query);
  return result.data;
}

export type PlanCounts = Record<string, number>;
export interface Snapshot {
  /** Rows per plan without FINAL: every version not merged away yet, tombstones included. */
  rawRows: PlanCounts;
  /** Tenants per plan with FINAL (the `Tenants` dataset). */
  final: PlanCounts;
  /** Tenants per plan from the argMax view (the `TenantsLatest` dataset). */
  argMax: PlanCounts;
}

const byPlan = (rows: readonly object[], key: string): PlanCounts =>
  Object.fromEntries(rows.map((r) => [String((r as Record<string, unknown>).plan), Number((r as Record<string, unknown>)[key])]));

/** The same per-plan question asked three ways. */
export async function snapshot(): Promise<Snapshot> {
  const order = [{ field: 'plan', direction: 'asc' }] as const;
  const [raw, final, latest] = await Promise.all([
    analytics.execute(TenantVersions, { dimensions: ['plan'], measures: ['rows'], orderBy: [...order] }),
    analytics.execute(Tenants, { dimensions: ['plan'], measures: ['tenants'], orderBy: [...order] }),
    analytics.execute(TenantsLatest, { dimensions: ['plan'], measures: ['tenants'], orderBy: [...order] }),
  ]);
  return { rawRows: byPlan(raw.data, 'rows'), final: byPlan(final.data, 'tenants'), argMax: byPlan(latest.data, 'tenants') };
}

/** Snapshot with merges held, then OPTIMIZE TABLE ... FINAL, then snapshot again. */
export async function beforeAndAfterOptimize(): Promise<{ beforeOptimize: Snapshot; afterOptimize: Snapshot }> {
  const beforeOptimize = await snapshot();
  await optimize();
  const afterOptimize = await snapshot();
  return { beforeOptimize, afterOptimize };
}

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const isMain = process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href;
if (isMain) {
  run()
    .then(async (rows) => {
      if (process.argv.includes('--write')) {
        // Run right after setup: the before state needs merges still held.
        const states = await beforeAndAfterOptimize();
        fs.writeFileSync(path.join(root, 'expected.sql'), `${toSQL()}\n`);
        fs.writeFileSync(path.join(root, 'output.json'), `${JSON.stringify(rows, null, 2)}\n`);
        fs.writeFileSync(path.join(root, 'states.json'), `${JSON.stringify(states, null, 2)}\n`);
        console.log('wrote expected.sql, output.json and states.json');
      } else if (process.argv.includes('--json')) {
        console.log(JSON.stringify(rows, null, 2));
      } else {
        const { beforeOptimize, afterOptimize } = await beforeAndAfterOptimize();
        const table = (s: Snapshot) =>
          Object.keys(s.final).map((plan) => ({ plan, rawRows: s.rawRows[plan] ?? 0, final: s.final[plan], argMax: s.argMax[plan] }));
        console.log('Before OPTIMIZE (merges held: 4 parts, 247 rows)\n');
        console.table(table(beforeOptimize));
        console.log('\nAfter OPTIMIZE TABLE ... FINAL (1 part)\n');
        console.table(table(afterOptimize));
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
