/**
 * The graduation guarantee, executed: the same datasets over the same rows
 * return the same results on ClickHouse and on Postgres, for every case in
 * the golden corpus. Guards must fail on both engines with the same message.
 *
 * POSTGRES_URL=postgres://postgres@localhost:55432/postgres \
 * CLICKHOUSE_URL=http://localhost:18123 CLICKHOUSE_PASSWORD=... \
 *   pnpm --filter @hypequery/postgres test:integration
 */
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createQueryBuilder } from '@hypequery/clickhouse';
import { createDatasetClient } from '@hypequery/datasets';
import { createPostgresQueryBuilder } from '../../index.js';
import { datasetCases, parityOnlyCases } from '../cases.js';
import { defineDatasets, TENANT } from '../fixtures.js';
import { parityCustomers, parityOrders } from '../support/parity-data.js';

const postgresUrl = process.env.POSTGRES_URL;
const clickhouseUrl = process.env.CLICKHOUSE_URL;
const clickhouseAuth = { username: process.env.CLICKHOUSE_USER ?? 'default', password: process.env.CLICKHOUSE_PASSWORD ?? '' };
const SCHEMA = 'hq_pg_parity';

async function clickhouse(sql: string, body?: string): Promise<void> {
  const url = new URL(clickhouseUrl!);
  url.searchParams.set('query', sql);
  const response = await fetch(url, {
    method: 'POST',
    headers: { Authorization: `Basic ${Buffer.from(`${clickhouseAuth.username}:${clickhouseAuth.password}`).toString('base64')}` },
    body,
  });
  if (!response.ok) throw new Error(`ClickHouse: ${await response.text()}`);
}

/**
 * Cases where ClickHouse itself is wrong and Postgres matches the ground
 * truth. Each stays asserted as a divergence, so fixing the bug fails here
 * and the entry is removed.
 */
const KNOWN_CLICKHOUSE_BUGS: Record<string, string> = {
  'composite-to-date-nested-formula':
    'The composite plan returns NULL to-date values outside UTC; the non-composite plan and Postgres agree on the true values.',
};

type Row = Record<string, unknown>;
type Outcome = { rows: Row[] } | { error: string };

/** Numbers compare to 1e-9 relative: the engines round float aggregates differently in the last digit. */
function close(left: unknown, right: unknown): boolean {
  if (left === right) return true;
  if (typeof left !== 'string' || typeof right !== 'string') return false;
  const a = Number(left);
  const b = Number(right);
  if (!Number.isFinite(a) || !Number.isFinite(b) || left.trim() === '' || right.trim() === '') return false;
  return Math.abs(a - b) <= 1e-9 * Math.max(1, Math.abs(a), Math.abs(b));
}

function rowsDiffer(clickhouseRows: Row[], postgresRows: Row[]): string | undefined {
  if (clickhouseRows.length !== postgresRows.length) {
    return `row count: ClickHouse ${clickhouseRows.length}, Postgres ${postgresRows.length}`;
  }
  for (const [index, expected] of clickhouseRows.entries()) {
    const actual = postgresRows[index]!;
    const keys = new Set([...Object.keys(expected), ...Object.keys(actual)]);
    for (const key of keys) {
      if (!close(normalize(expected[key]), normalize(actual[key]))) {
        return `row ${index} "${key}": ClickHouse ${JSON.stringify(expected[key])}, Postgres ${JSON.stringify(actual[key])}\n`
          + `ClickHouse row ${JSON.stringify(expected)}\nPostgres row   ${JSON.stringify(actual)}`;
      }
    }
  }
  return undefined;
}

/** Values both engines return as text, compared as text; anything else as JSON. */
function normalize(value: unknown): unknown {
  if (value === null || value === undefined) return null;
  return typeof value === 'string' ? value : JSON.stringify(value);
}

/** Order rows deterministically: ties in the requested ORDER BY may break differently. */
function sorted(rows: Row[], ordered: boolean): Row[] {
  return ordered ? rows : [...rows].sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
}

describe.skipIf(!postgresUrl || !clickhouseUrl)('ClickHouse ↔ Postgres parity', () => {
  let pool: pg.Pool;
  const { Orders } = defineDatasets(SCHEMA);
  let clickhouseClient: ReturnType<typeof createDatasetClient>;
  let postgresClient: ReturnType<typeof createDatasetClient>;

  beforeAll(async () => {
    const orders = parityOrders();
    const customers = parityCustomers();

    await clickhouse(`DROP DATABASE IF EXISTS ${SCHEMA}`);
    await clickhouse(`CREATE DATABASE ${SCHEMA}`);
    await clickhouse(`CREATE TABLE ${SCHEMA}.orders (tenant_id String, customer_id Nullable(Int64), status Nullable(String),
      region_code String, is_gift Bool, amount_cents Int64, created_at DateTime64(3, 'UTC')) ENGINE = MergeTree ORDER BY tuple()`);
    await clickhouse(`CREATE TABLE ${SCHEMA}.customers (customer_id Int64, tenant_id String, country_code String, tier String)
      ENGINE = MergeTree ORDER BY tuple()`);
    await clickhouse(`INSERT INTO ${SCHEMA}.orders FORMAT JSONEachRow`, orders.map(row => JSON.stringify(row)).join('\n'));
    await clickhouse(`INSERT INTO ${SCHEMA}.customers FORMAT JSONEachRow`, customers.map(row => JSON.stringify(row)).join('\n'));

    pool = new pg.Pool({ connectionString: postgresUrl, max: 4 });
    await pool.query(`DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE`);
    await pool.query(`CREATE SCHEMA ${SCHEMA}`);
    await pool.query(`CREATE TABLE ${SCHEMA}.orders (tenant_id text, customer_id bigint, status text, region_code text,
      is_gift boolean, amount_cents bigint, created_at timestamptz)`);
    await pool.query(`CREATE TABLE ${SCHEMA}.customers (customer_id bigint, tenant_id text, country_code text, tier text)`);
    await pool.query(
      `INSERT INTO ${SCHEMA}.orders SELECT * FROM json_populate_recordset(NULL::${SCHEMA}.orders, $1)`,
      [JSON.stringify(orders.map(row => ({ ...row, created_at: `${row.created_at}Z` })))],
    );
    await pool.query(
      `INSERT INTO ${SCHEMA}.customers SELECT * FROM json_populate_recordset(NULL::${SCHEMA}.customers, $1)`,
      [JSON.stringify(customers)],
    );

    const url = new URL(clickhouseUrl!);
    clickhouseClient = createDatasetClient({
      queryBuilder: createQueryBuilder({ host: `${url.protocol}//${url.host}`, ...clickhouseAuth, database: SCHEMA }),
    });
    postgresClient = createDatasetClient({ queryBuilder: createPostgresQueryBuilder({ pool }) });
  }, 60_000);

  afterAll(async () => {
    // PARITY_KEEP=1 leaves the seeded tables in place for debugging a diff.
    if (!process.env.PARITY_KEEP) {
      await clickhouse(`DROP DATABASE IF EXISTS ${SCHEMA}`).catch(() => {});
      await pool?.query(`DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE`);
    }
    await pool?.end();
  });

  async function run(client: ReturnType<typeof createDatasetClient>, query: object): Promise<Outcome> {
    try {
      const result = await client.execute(Orders, query as never, { ...TENANT, cache: false } as never);
      return { rows: result.data as Row[] };
    } catch (error) {
      return { error: error instanceof Error ? error.message : String(error) };
    }
  }

  it.each(Object.entries({ ...datasetCases, ...parityOnlyCases }))('%s', async (_name, query) => {
    const [onClickHouse, onPostgres] = await Promise.all([run(clickhouseClient, query), run(postgresClient, query)]);
    if ('error' in onClickHouse || 'error' in onPostgres) {
      // A guard must fire on both engines, with the message the planner wrote.
      if ('error' in onPostgres && process.env.PARITY_DEBUG) console.log(`PGERR ${_name}: ${onPostgres.error}`);
      expect('error' in onPostgres, `Postgres: ${JSON.stringify(onPostgres).slice(0, 400)}`).toBe(true);
      expect('error' in onClickHouse, `ClickHouse: ${JSON.stringify(onClickHouse).slice(0, 400)}`).toBe(true);
      const message = (onPostgres as { error: string }).error;
      expect((onClickHouse as { error: string }).error).toContain(message);
      return;
    }
    const ordered = Boolean(query.orderBy?.length) || Boolean(query.by && !query.dimensions?.length);
    const difference = rowsDiffer(sorted(onClickHouse.rows, ordered), sorted(onPostgres.rows, ordered));
    if (KNOWN_CLICKHOUSE_BUGS[_name]) {
      expect(difference, `ClickHouse bug fixed? Remove "${_name}" from KNOWN_CLICKHOUSE_BUGS.`).toBeDefined();
      return;
    }
    expect(difference).toBeUndefined();
  });
});
