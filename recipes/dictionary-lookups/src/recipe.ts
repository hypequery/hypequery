import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { createClient } from '@clickhouse/client';
import { between, type DatasetQueryFor } from '@hypequery/datasets';
import { analytics, connection, db } from './client.js';
import { Events, EventsJoined } from './dataset.js';

/** October 2026; fixed so the output is reproducible. */
export const RANGE: [string, string] = ['2026-10-01 00:00:00', '2026-10-31 23:59:59'];

/** Events and active tenants per plan and region, with plan and region from the dictionary. */
export const query = {
  dimensions: ['plan', 'region'],
  measures: ['events', 'tenants'],
  filters: [between('occurredAt', RANGE[0], RANGE[1])],
  orderBy: [
    { field: 'plan', direction: 'asc' },
    { field: 'region', direction: 'asc' },
  ],
} satisfies DatasetQueryFor<typeof Events>;

/** The same question through the `tenant` relationship: a LEFT ANY JOIN to the tenants table. */
export const joinedQuery = {
  dimensions: ['tenant.plan', 'tenant.region'],
  measures: ['events', 'tenants'],
  filters: [between('occurredAt', RANGE[0], RANGE[1])],
  orderBy: [
    { field: 'tenant.plan', direction: 'asc' },
    { field: 'tenant.region', direction: 'asc' },
  ],
} satisfies DatasetQueryFor<typeof EventsJoined>;

export function toSQL(): string {
  return analytics.toSQL(Events, query);
}

export async function run() {
  return (await analytics.execute(Events, query)).data;
}

export async function runJoined() {
  return (await analytics.execute(EventsJoined, joinedQuery)).data;
}

export interface Timing {
  /** Median server-side duration over the runs, from system.query_log. */
  medianMs: number;
  runsMs: number[];
  readRows: number;
  peakMemoryBytes: number;
}

/**
 * Run a compiled dataset query several times with known query ids and read
 * duration, rows read and memory back from system.query_log. Durations vary
 * with the machine and its load; rows read do not.
 */
export async function time(target: 'dictGet' | 'join', runs = 5): Promise<Timing> {
  const { sql, parameters } =
    target === 'dictGet' ? analytics.compileDataset(Events, query) : analytics.compileDataset(EventsJoined, joinedQuery);
  const ids: string[] = [];
  for (let i = 0; i < runs; i++) {
    const queryId = `dictionary-lookups-${target}-${randomUUID()}`;
    await db.rawQuery(sql, [...parameters], { queryId, clickhouseSettings: { use_query_cache: 0 } });
    ids.push(queryId);
  }
  const client = createClient(connection);
  try {
    await client.command({ query: 'SYSTEM FLUSH LOGS' });
    const result = await client.query({
      query: `SELECT query_duration_ms AS ms, read_rows, memory_usage FROM system.query_log
              WHERE query_id IN {ids:Array(String)} AND type = 'QueryFinish'`,
      query_params: { ids },
      format: 'JSONEachRow',
    });
    const rows = await result.json<{ ms: string; read_rows: string; memory_usage: string }>();
    const runsMs = rows.map((r) => Number(r.ms)).sort((a, b) => a - b);
    return {
      medianMs: runsMs[Math.floor(runsMs.length / 2)],
      runsMs,
      readRows: Number(rows[0].read_rows),
      peakMemoryBytes: Math.max(...rows.map((r) => Number(r.memory_usage))),
    };
  } finally {
    await client.close();
  }
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
        console.log(`Events per plan and region, ${RANGE[0].slice(0, 10)} to ${RANGE[1].slice(0, 10)}\n`);
        console.table(rows);
        const joined = await runJoined();
        const same = JSON.stringify(joined.map((r) => [r['tenant.plan'], r['tenant.region'], r.events, r.tenants])) ===
          JSON.stringify(rows.map((r) => [r.plan, r.region, r.events, r.tenants]));
        console.log(`\nJOIN version returns the same rows: ${same}`);
        for (const target of ['dictGet', 'join'] as const) {
          const t = await time(target);
          console.log(`${target.padEnd(7)}  median ${t.medianMs} ms  runs ${t.runsMs.join('/')} ms  read ${t.readRows} rows  peak memory ${(t.peakMemoryBytes / 1e6).toFixed(1)} MB`);
        }
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
