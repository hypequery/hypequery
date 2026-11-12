import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { between, type DatasetQueryFor } from '@hypequery/datasets';
import { analytics, db } from './client.js';
import { Events } from './dataset.js';

/**
 * Five full ISO weeks around the seed's only year boundary, Monday 2025-12-15
 * to Sunday 2026-01-18. Fixed so the output is reproducible.
 */
export const RANGE: [string, string] = ['2025-12-15 00:00:00', '2026-01-18 23:59:59'];

/**
 * The question: events and active users per ISO week, with the first and last
 * event in each bucket to prove where the week starts and ends.
 */
export const query = {
  dimensions: ['isoWeek', 'isoWeekStart'],
  measures: ['events', 'activeUsers', 'firstEventAt', 'lastEventAt'],
  filters: [between('occurredAt', RANGE[0], RANGE[1])],
  orderBy: [{ field: 'isoWeekStart', direction: 'asc' }],
} satisfies DatasetQueryFor<typeof Events>;

export function toSQL(): string {
  return analytics.toSQL(Events, query);
}

export async function run() {
  const result = await analytics.execute(Events, query);
  return result.data;
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
        console.log(`Events per ISO week, ${RANGE[0].slice(0, 10)} to ${RANGE[1].slice(0, 10)}\n`);
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
