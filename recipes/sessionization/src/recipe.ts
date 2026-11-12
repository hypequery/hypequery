import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { between, type DatasetQueryFor } from '@hypequery/datasets';
import { analytics, db } from './client.js';
import { Sessions } from './dataset.js';

/** The seed's last full week; fixed so the output is reproducible. */
export const RANGE: [string, string] = ['2026-10-25 00:00:00', '2026-10-31 23:59:59'];

/**
 * The question: per day of the last week, how many sessions started, by how
 * many users, and how long and how busy was the average session?
 */
export const query = {
  by: 'day',
  measures: ['sessions', 'users', 'sessionsPerUser', 'avgDurationSeconds', 'avgEventsPerSession'],
  filters: [between('sessionStart', RANGE[0], RANGE[1])],
} satisfies DatasetQueryFor<typeof Sessions>;

export function toSQL(): string {
  return analytics.toSQL(Sessions, query);
}

export async function run() {
  const result = await analytics.execute(Sessions, query);
  return result.data;
}

/** The whole week as one row. */
export async function week() {
  const { by: _by, ...rest } = query;
  const result = await analytics.execute(Sessions, rest);
  return result.data[0];
}

export interface TimeoutRow {
  timeoutMinutes: number;
  sessions: string;
  avgDurationSeconds: number;
}

/**
 * How much the answer depends on the timeout: the same week sessionized with
 * 15, 30 and 60 minutes. A raw query, because the timeout lives in the SQL
 * that builds sessions, not in a measure.
 */
export async function compareTimeouts(): Promise<TimeoutRow[]> {
  const rows: TimeoutRow[] = [];
  for (const minutes of [15, 30, 60]) {
    const [row] = await db.rawQuery<Omit<TimeoutRow, 'timeoutMinutes'>>(
      `SELECT count() AS sessions, round(avg(duration), 1) AS avgDurationSeconds
       FROM (
         SELECT user_id, min(occurred_at) AS start, dateDiff('second', min(occurred_at), max(occurred_at)) AS duration
         FROM (
           SELECT user_id, occurred_at,
                  sum(toUInt32(dateDiff('second', previous_at, occurred_at) > ?)) OVER w AS session_number
           FROM (
             SELECT tenant_id, user_id, event_id, occurred_at,
                    lagInFrame(occurred_at, 1, toDateTime(0, 'UTC')) OVER w AS previous_at
             FROM events
             WINDOW w AS (PARTITION BY tenant_id, user_id ORDER BY occurred_at, event_id ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW)
           )
           WINDOW w AS (PARTITION BY tenant_id, user_id ORDER BY occurred_at, event_id ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW)
         )
         GROUP BY user_id, session_number
       )
       WHERE start BETWEEN ? AND ?`,
      [minutes * 60, RANGE[0], RANGE[1]],
    );
    rows.push({ timeoutMinutes: minutes, sessions: row.sessions, avgDurationSeconds: Number(row.avgDurationSeconds) });
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
        console.log(`Sessions per day (30-minute timeout), ${RANGE[0].slice(0, 10)} to ${RANGE[1].slice(0, 10)}\n`);
        console.table(rows);
        console.log('\nWhole week:');
        console.table([await week()]);
        console.log('\nTimeout sensitivity:');
        console.table(await compareTimeouts());
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
