import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { between, eq, type DatasetQueryFor } from '@hypequery/datasets';
import { analytics, db } from './client.js';
import { TenantPaths } from './dataset.js';

/** October 2026 for five tenants, fixed so the output is reproducible. */
export const RANGE: [string, string] = ['2026-10-01 00:00:00', '2026-10-31 23:59:59'];
export const TENANTS = [1, 2, 3, 4, 5];
export const TOP_N = 3;

/**
 * Top 3 paths per tenant in one query. LIMIT n BY col keeps the first n rows
 * of each col value in ORDER BY order, so the ORDER BY is the ranking:
 * tenant, then events descending, then path as a deterministic tiebreak.
 */
export function topPathsPerTenant() {
  return db
    .table('events')
    .select(['tenant_id', 'path'])
    .count('event_id', 'events')
    .where('tenant_id', 'in', TENANTS)
    .where('occurred_at', 'between', RANGE)
    .groupBy(['tenant_id', 'path'])
    .orderBy('tenant_id', 'ASC')
    .orderBy('events', 'DESC')
    .orderBy('path', 'ASC')
    .limitBy(TOP_N, 'tenant_id');
}

/** One tenant only (a tenant-scoped dashboard): a dataset query with a plain LIMIT. */
export function topPathsForTenant(tenantId: number) {
  return {
    dimensions: ['path'],
    measures: ['events'],
    filters: [eq('tenantId', tenantId), between('occurredAt', RANGE[0], RANGE[1])],
    orderBy: [
      { field: 'events', direction: 'desc' },
      { field: 'path', direction: 'asc' },
    ],
    limit: TOP_N,
  } satisfies DatasetQueryFor<typeof TenantPaths>;
}

export function toSQL(): string {
  return topPathsPerTenant().toSQL();
}

export async function run() {
  return topPathsPerTenant().execute();
}

export async function runForTenant(tenantId: number) {
  return (await analytics.execute(TenantPaths, topPathsForTenant(tenantId))).data;
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
        console.log(`Top ${TOP_N} paths per tenant, ${RANGE[0].slice(0, 10)} to ${RANGE[1].slice(0, 10)}\n`);
        console.table(rows);
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
