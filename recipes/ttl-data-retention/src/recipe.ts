import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { DatasetQueryFor } from '@hypequery/datasets';
import { analytics, db } from './client.js';
import { Events } from './dataset.js';
import { materialize } from './setup.js';

/** Per plan: how many events are kept, how many still have a path, and the oldest one left. */
export const query = {
  dimensions: ['plan'],
  measures: ['events', 'eventsWithPath', 'oldestEvent', 'newestEvent'],
  orderBy: [{ field: 'plan', direction: 'asc' }],
} satisfies DatasetQueryFor<typeof Events>;

export function toSQL(): string {
  return analytics.toSQL(Events, query);
}

export async function run() {
  const result = await analytics.execute(Events, query);
  return result.data;
}

/** The query before MATERIALIZE TTL (rules declared, nothing removed) and after it. */
export async function beforeAndAfterTTL() {
  const beforeMaterialize = await run();
  await materialize();
  const afterMaterialize = await run();
  return { beforeMaterialize, afterMaterialize };
}

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const isMain = process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href;
if (isMain) {
  (async () => {
    if (process.argv.includes('--json')) {
      // Whatever state the table is in; after `pnpm dev` that is the retained data.
      console.log(JSON.stringify(await run(), null, 2));
    } else if (process.argv.includes('--write')) {
      // Run right after setup, while the rules are not materialized yet.
      const states = await beforeAndAfterTTL();
      fs.writeFileSync(path.join(root, 'expected.sql'), `${toSQL()}\n`);
      fs.writeFileSync(path.join(root, 'output.json'), `${JSON.stringify(states.afterMaterialize, null, 2)}\n`);
      fs.writeFileSync(path.join(root, 'states.json'), `${JSON.stringify(states, null, 2)}\n`);
      console.log('wrote expected.sql, output.json and states.json');
    } else {
      const { beforeMaterialize, afterMaterialize } = await beforeAndAfterTTL();
      console.log('TTL rules declared, not yet materialized\n');
      console.table(beforeMaterialize);
      console.log('\nAfter ALTER TABLE ... MATERIALIZE TTL\n');
      console.table(afterMaterialize);
      console.log('\nGenerated SQL:\n' + toSQL());
    }
    await db.close();
  })().catch(async (error) => {
    console.error(error instanceof Error ? error.message : error);
    await db.close();
    process.exit(1);
  });
}
