import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { db } from './client.js';
import { compareCost, createCopy, dropCopy } from './cost.js';
import { decodeCursor, keysetPage, keysetPageQuery } from './pagination.js';

/** Tenant 47 has the most events in the seed (97,376). Its newest events first, 50 a page. */
export const TENANT = 47;
export const PAGE_SIZE = 50;
/** Page numbers (1-based) for the cost comparison: offsets 0, 1,000, 10,000 and 50,000. */
export const DEPTHS = [1, 21, 201, 1001];

/** The first two pages, as an API would serve them. */
export async function run() {
  const first = await keysetPage(TENANT, PAGE_SIZE, null);
  const second = await keysetPage(TENANT, PAGE_SIZE, first.nextCursor);
  return { page1: first.rows, cursor: first.nextCursor, page2: second.rows, nextCursor: second.nextCursor };
}

/** The SQL for page 2: the keyset condition built from page 1's last row. */
export async function toSQL(): Promise<string> {
  const { cursor } = await run();
  return keysetPageQuery(TENANT, PAGE_SIZE, decodeCursor(cursor!)).toSQLWithParams().sql;
}

export async function cost() {
  await createCopy();
  return compareCost(TENANT, PAGE_SIZE, DEPTHS.map((p) => p - 1));
}

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const isMain = process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href;
if (isMain) {
  run()
    .then(async (pages) => {
      if (process.argv.includes('--write')) {
        // Capture the artifacts shown on the recipe page and asserted in CI.
        fs.writeFileSync(path.join(root, 'expected.sql'), `${await toSQL()}\n`);
        fs.writeFileSync(path.join(root, 'output.json'), `${JSON.stringify(pages, null, 2)}\n`);
        console.log('wrote expected.sql and output.json');
      } else if (process.argv.includes('--json')) {
        console.log(JSON.stringify(pages, null, 2));
      } else {
        console.log(`Tenant ${TENANT}, newest first, ${PAGE_SIZE} per page\n\nPage 1 (first 5 rows):`);
        console.table(pages.page1.slice(0, 5));
        console.log(`cursor: ${pages.cursor}\n\nPage 2 (first 5 rows):`);
        console.table(pages.page2.slice(0, 5));
        console.log('\nOFFSET vs keyset (granules after the primary key, rows actually read):');
        console.table(await cost());
        await dropCopy();
        console.log('\nPage 2 SQL:\n' + (await toSQL()));
      }
      await db.close();
    })
    .catch(async (error) => {
      console.error(error instanceof Error ? error.message : error);
      await db.close();
      process.exit(1);
    });
}
