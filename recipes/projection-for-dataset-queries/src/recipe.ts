import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { createClient } from '@clickhouse/client';
import { between, eq, type DatasetQueryFor } from '@hypequery/datasets';
import { analytics, connection, db } from './client.js';
import { Events } from './dataset.js';

/** The seed's last full week; fixed so the output is reproducible. */
export const RANGE: [string, string] = ['2026-10-25', '2026-10-31'];

/**
 * Daily events and latency for a week. Groups and filters on `day`, the
 * aggregate projection's key, so ClickHouse reads `daily_by_type`.
 */
export const query = {
  dimensions: ['day'],
  measures: ['events', 'totalLatencyMs', 'avgLatencyMs'],
  filters: [between('day', RANGE[0], RANGE[1])],
  orderBy: [{ field: 'day', direction: 'asc' }],
} satisfies DatasetQueryFor<typeof Events>;

/** One user's events by type. Filters on user_id, the `by_user` projection's sort key. */
export const userQuery = {
  dimensions: ['eventType'],
  measures: ['events', 'totalLatencyMs'],
  filters: [eq('userId', 42)],
  orderBy: [
    { field: 'events', direction: 'desc' },
    { field: 'eventType', direction: 'asc' },
  ],
} satisfies DatasetQueryFor<typeof Events>;

export function toSQL(): string {
  return analytics.toSQL(Events, query);
}

export async function run() {
  const result = await analytics.execute(Events, query);
  return result.data;
}

export interface Profile {
  /** Projections ClickHouse read, from system.query_log. Empty means the base table. */
  projections: string[];
  readRows: number;
  rows: unknown[];
}

/**
 * Run the exact SQL the dataset compiles to, with projections on or off, and
 * read back from system.query_log which projection served it and how many
 * rows it read.
 */
export async function profile(q: DatasetQueryFor<typeof Events>, useProjections = true): Promise<Profile> {
  const { sql, parameters } = analytics.compileDataset(Events, q);
  const queryId = `projection-for-dataset-queries-${randomUUID()}`;
  const rows = await db.rawQuery(sql, [...parameters], {
    queryId,
    clickhouseSettings: { optimize_use_projections: useProjections ? 1 : 0 },
  });
  const client = createClient(connection);
  try {
    await client.command({ query: 'SYSTEM FLUSH LOGS' });
    const log = await client.query({
      query: `SELECT projections, read_rows FROM system.query_log
              WHERE query_id = {id:String} AND type = 'QueryFinish' LIMIT 1`,
      query_params: { id: queryId },
      format: 'JSONEachRow',
    });
    const [entry] = await log.json<{ projections: string[]; read_rows: string }>();
    return { projections: entry.projections.map((p) => p.split('.').pop()!), readRows: Number(entry.read_rows), rows };
  } finally {
    await client.close();
  }
}

/** EXPLAIN for the dataset's SQL with the parameters inlined: which part of the table is read. */
export async function explain(q: DatasetQueryFor<typeof Events>): Promise<string> {
  const { sql, parameters } = analytics.compileDataset(Events, q);
  const rows = await db.rawQuery<{ explain: string }>(`EXPLAIN projections = 1 ${sql}`, [...parameters]);
  return rows.map((r) => r.explain).join('\n');
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
        console.log(`Daily events, ${RANGE[0]} to ${RANGE[1]}\n`);
        console.table(rows);
        for (const [name, q] of [['daily query', query], ['user query', userQuery]] as const) {
          const on = await profile(q, true);
          const off = await profile(q, false);
          console.log(`${name}: projection ${on.projections.join(', ') || '(none)'} read ${on.readRows} rows; without projections ${off.readRows} rows`);
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
