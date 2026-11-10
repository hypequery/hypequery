import { performance } from 'node:perf_hooks';
import { sql } from 'drizzle-orm';
import { db } from '../analytics/client.js';
import { closePostgres, pgdb, usingPglite } from '../db/client.js';

/**
 * `pnpm bench`: "why not just Postgres?" Copies the seed's 1M events into a
 * Postgres table, runs the same 12-month per-account rollup on both databases,
 * prints the median of 5 runs, and drops the copy. Point DATABASE_URL at a
 * real Postgres for a fair number; PGlite (WASM) is slower than native.
 */
const TABLE = 'bench_events';
const BATCH = 50_000;
const ROLLUP = (from: string) => `SELECT tenant_id, count(*) AS events, count(DISTINCT user_id) AS users,
  avg(latency_ms) AS avg_latency, max(occurred_at) AS last_seen FROM ${from} GROUP BY tenant_id ORDER BY events DESC LIMIT 20`;

async function median(run: () => Promise<unknown>): Promise<number> {
  const times: number[] = [];
  for (let i = 0; i < 5; i++) {
    const t = performance.now();
    await run();
    times.push(performance.now() - t);
  }
  return times.sort((a, b) => a - b)[2];
}

await pgdb.execute(sql.raw(`DROP TABLE IF EXISTS ${TABLE}`));
await pgdb.execute(sql.raw(`CREATE TABLE ${TABLE} (event_id bigint, tenant_id int, user_id int, event_type text,
  latency_ms int, occurred_at timestamp)`));

const [{ total }] = await db.rawQuery<{ total: string }>('SELECT count() AS total FROM events');
for (let offset = 0; offset < Number(total); offset += BATCH) {
  const rows = await db.rawQuery<Record<string, string | number>>(`SELECT event_id, tenant_id, user_id, event_type, latency_ms,
    toString(occurred_at) AS occurred_at FROM events ORDER BY event_id LIMIT ${BATCH} OFFSET ${offset}`);
  const col = (k: string) => `ARRAY[${rows.map((r) => (typeof r[k] === 'number' ? r[k] : `'${r[k]}'`)).join(',')}]`;
  await pgdb.execute(sql.raw(`INSERT INTO ${TABLE} SELECT * FROM unnest(${col('event_id')}::bigint[], ${col('tenant_id')}::int[],
    ${col('user_id')}::int[], ${col('event_type')}::text[], ${col('latency_ms')}::int[], ${col('occurred_at')}::timestamp[])`));
}
await pgdb.execute(sql.raw(`CREATE INDEX ON ${TABLE} (tenant_id, occurred_at)`));
await pgdb.execute(sql.raw(`ANALYZE ${TABLE}`));

const pgMs = await median(() => pgdb.execute(sql.raw(ROLLUP(TABLE))));
const chMs = await median(() => db.rawQuery(ROLLUP('events')));
console.log(`${Number(total).toLocaleString()} events, per-account rollup (count, distinct users, avg latency, last seen):`);
console.log(`  ${usingPglite ? 'PGlite ' : 'Postgres'}  ${pgMs.toFixed(0)} ms`);
console.log(`  ClickHouse ${chMs.toFixed(0)} ms  (${(pgMs / chMs).toFixed(0)}x)`);

await pgdb.execute(sql.raw(`DROP TABLE ${TABLE}`));
await closePostgres();
await db.close();
