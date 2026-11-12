import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { rawAs } from '@hypequery/clickhouse';
import { between, inList, type DatasetQueryFor } from '@hypequery/datasets';
import { analytics, db } from './client.js';
import { UserActivity } from './dataset.js';

/** One day and three users, fixed so the output is reproducible. */
export const DAY: [string, string] = ['2026-10-29 00:00:00', '2026-10-29 23:59:59'];
export const USERS = [112, 113, 245];

/**
 * groupArray keeps values in whatever order the rows reach it, which depends
 * on parts, partitions and threads, not on time. Collect (time, id, value)
 * tuples instead and sort them: tuples compare element by element, so this
 * orders by time, then event_id for events in the same second.
 */
const SORTED = 'arraySort(groupArray((occurred_at, event_id, path)))';

export function timelines() {
  return db
    .table('events')
    .select([
      'user_id',
      rawAs<string[], 'paths'>(`arrayMap(e -> e.3, ${SORTED})`, 'paths'),
      // Seconds since the previous step; arrayDifference returns Int64 (a JSON
      // string by default), so narrow it to Int32 to get numbers back.
      rawAs<number[], 'gapsSeconds'>(`arrayMap(d -> toInt32(d), arrayDifference(arrayMap(e -> e.1, ${SORTED})))`, 'gapsSeconds'),
      // groupArraySorted(N) keeps the N smallest values, sorted, without collecting the rest.
      rawAs<string[], 'firstThree'>('arrayMap(e -> e.3, groupArraySorted(3)((occurred_at, event_id, path)))', 'firstThree'),
      // Raw, like the arrays: the builder infers GROUP BY keys from selections
      // it does not recognise as aggregates when a helper such as .count() is
      // added, and arrayMap(... groupArray ...) is one of those.
      rawAs<string, 'events'>('count()', 'events'),
    ])
    .where('user_id', 'in', USERS)
    .where('occurred_at', 'between', DAY)
    .groupBy('user_id')
    .orderBy('user_id', 'ASC');
}

/** The same users and day through the dataset: scalar first/last facts. */
export const summaryQuery = {
  dimensions: ['userId'],
  measures: ['events', 'firstEventAt', 'lastEventAt', 'firstPath', 'lastPath'],
  filters: [inList('userId', USERS), between('occurredAt', DAY[0], DAY[1])],
  orderBy: [{ field: 'userId', direction: 'asc' }],
} satisfies DatasetQueryFor<typeof UserActivity>;

export function toSQL(): string {
  return timelines().toSQL();
}

export async function run() {
  return timelines().execute();
}

export async function runSummary() {
  return (await analytics.execute(UserActivity, summaryQuery)).data;
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
        console.log(`Ordered timelines for users ${USERS.join(', ')} on ${DAY[0].slice(0, 10)}\n`);
        for (const row of rows) console.log(`user ${row.user_id} (${row.events} events): ${row.paths.join(' → ')}`);
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
