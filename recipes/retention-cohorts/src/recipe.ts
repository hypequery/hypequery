import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { between, lte, type DatasetQueryFor } from '@hypequery/datasets';
import { analytics, db } from './client.js';
import { CohortRetention } from './dataset.js';

/** June 2026 signup cohorts, followed for six weeks. Fixed so the output is reproducible. */
export const COHORTS: [string, string] = ['2026-06-01', '2026-06-30'];
export const MAX_WEEKS = 6;

/**
 * The question: of the users who signed up each week, what share was active
 * 0, 1, 2 ... 6 weeks later? One row per (cohort, week offset).
 */
export const query = {
  dimensions: ['cohortWeek', 'weeksSinceSignup'],
  measures: ['cohortSize', 'activeUsers', 'retention'],
  filters: [between('cohortWeek', `${COHORTS[0]} 00:00:00`, `${COHORTS[1]} 23:59:59`), lte('weeksSinceSignup', MAX_WEEKS)],
  orderBy: [
    { field: 'cohortWeek', direction: 'asc' },
    { field: 'weeksSinceSignup', direction: 'asc' },
  ],
} satisfies DatasetQueryFor<typeof CohortRetention>;

export function toSQL(): string {
  return analytics.toSQL(CohortRetention, query);
}

export async function run() {
  const result = await analytics.execute(CohortRetention, query);
  return result.data;
}

/** Pivot rows into the familiar cohort grid: one line per cohort, one column per week. */
export function toGrid(rows: Awaited<ReturnType<typeof run>>): Array<Record<string, string>> {
  const grid = new Map<string, Record<string, string>>();
  for (const row of rows) {
    const cohort = String(row.cohortWeek).slice(0, 10);
    const line = grid.get(cohort) ?? { cohort, size: String(row.cohortSize) };
    line[`w${row.weeksSinceSignup}`] = `${(Number(row.retention) * 100).toFixed(0)}%`;
    grid.set(cohort, line);
  }
  return [...grid.values()];
}

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const isMain = process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href;
if (isMain) {
  run()
    .then(async (rows) => {
      if (process.argv.includes('--write')) {
        fs.writeFileSync(path.join(root, 'expected.sql'), `${toSQL()}\n`);
        fs.writeFileSync(path.join(root, 'output.json'), `${JSON.stringify(rows, null, 2)}\n`);
        console.log('wrote expected.sql and output.json');
      } else if (process.argv.includes('--json')) {
        console.log(JSON.stringify(rows, null, 2));
      } else {
        console.log(`Weekly retention, signup cohorts ${COHORTS[0]} to ${COHORTS[1]}\n`);
        console.table(toGrid(rows));
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
