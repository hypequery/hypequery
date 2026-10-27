/**
 * Datasets against a live Postgres. Every expected value is computed in JS
 * from the seeded rows, so a wrong spelling shows as a wrong number rather
 * than a snapshot diff.
 *
 * POSTGRES_URL=postgres://postgres@localhost:55432/postgres pnpm --filter @hypequery/postgres test:integration
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createDatasetClient, dataset, dimension, measure, type TimeGrain } from '@hypequery/datasets';
import { createPgDriver, createPostgresQueryBuilder } from '../../index.js';
import { Orders, TENANT } from '../fixtures.js';

const url = process.env.POSTGRES_URL;
const SCHEMA = 'analytics';

interface OrderRow {
  id: number; tenant: string; customer: number | null; status: string | null; region: string;
  gift: boolean; amount: number; at: string;
}

const ORDERS: OrderRow[] = [
  { id: 1, tenant: 'acme', customer: 1, status: 'paid', region: 'eu', gift: false, amount: 1000, at: '2026-01-01T10:00:00Z' },
  { id: 2, tenant: 'acme', customer: 1, status: 'paid', region: 'us', gift: true, amount: 2500, at: '2026-01-02T03:00:00Z' },
  { id: 3, tenant: 'acme', customer: 2, status: 'shipped', region: 'eu', gift: false, amount: 700, at: '2026-01-05T12:00:00Z' },
  { id: 4, tenant: 'acme', customer: 3, status: 'refunded', region: 'apac', gift: false, amount: 300, at: '2026-02-10T12:00:00Z' },
  { id: 5, tenant: 'acme', customer: null, status: null, region: 'us', gift: false, amount: 50, at: '2026-02-11T00:30:00Z' },
  { id: 6, tenant: 'acme', customer: 2, status: 'paid', region: 'us', gift: true, amount: 4100, at: '2026-03-01T23:00:00Z' },
  { id: 7, tenant: 'other', customer: 9, status: 'paid', region: 'eu', gift: false, amount: 99999, at: '2026-01-03T00:00:00Z' },
];
// Customer 2 is duplicated on purpose: a single-match join must not double-count its orders.
const CUSTOMERS = [
  { id: 1, tenant: 'acme', country: 'DE', tier: 'gold' },
  { id: 2, tenant: 'acme', country: 'US', tier: 'silver' },
  { id: 2, tenant: 'acme', country: 'US', tier: 'silver' },
  { id: 3, tenant: 'acme', country: 'JP', tier: 'gold' },
  { id: 9, tenant: 'other', country: 'FR', tier: 'gold' },
];

const acme = ORDERS.filter(order => order.tenant === 'acme');
const sum = (rows: OrderRow[]) => rows.reduce((total, row) => total + row.amount, 0);

describe.skipIf(!url)('datasets on Postgres', () => {
  let pool: pg.Pool;
  let client: ReturnType<typeof createDatasetClient>;

  beforeAll(async () => {
    pool = new pg.Pool({ connectionString: url, max: 4 });
    await pool.query(`DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE`);
    await pool.query(`CREATE SCHEMA ${SCHEMA}`);
    await pool.query(`CREATE TABLE ${SCHEMA}.orders (
      id int, tenant_id text, customer_id int, status text, region_code text, is_gift boolean,
      amount_cents bigint, created_at timestamptz)`);
    await pool.query(`CREATE TABLE ${SCHEMA}.customers (customer_id int, tenant_id text, country_code text, tier text)`);
    for (const o of ORDERS) {
      await pool.query(`INSERT INTO ${SCHEMA}.orders VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [o.id, o.tenant, o.customer, o.status, o.region, o.gift, o.amount, o.at]);
    }
    for (const c of CUSTOMERS) {
      await pool.query(`INSERT INTO ${SCHEMA}.customers VALUES ($1, $2, $3, $4)`, [c.id, c.tenant, c.country, c.tier]);
    }
    client = createDatasetClient({ queryBuilder: createPostgresQueryBuilder({ pool }) });
  });

  afterAll(async () => {
    await pool?.query(`DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE`);
    await pool?.end();
  });

  const run = async (query: object) => (await client.execute(Orders, query as never, TENANT)).data as Record<string, unknown>[];

  it('aggregates every measure kind, scoped to the tenant', async () => {
    const rows = await run({
      measures: ['revenue', 'orders', 'buyers', 'approxBuyers', 'avgAmount', 'minAmount', 'maxAmount', 'topRegion', 'bottomRegion'],
    });
    const amounts = acme.map(order => order.amount);
    expect(rows).toEqual([{
      revenue: String(sum(acme)),
      orders: String(acme.filter(order => order.status !== null).length),
      buyers: '3',
      approxBuyers: '3',
      avgAmount: String(sum(acme) / acme.length),
      minAmount: String(Math.min(...amounts)),
      maxAmount: String(Math.max(...amounts)),
      topRegion: 'US',
      bottomRegion: 'US',
    }]);
  });

  it('computes percentile, stddev and variance', async () => {
    const [row] = await run({ measures: ['p95', 'spread', 'variance'] });
    const amounts = acme.map(order => order.amount).sort((a, b) => a - b);
    const mean = sum(acme) / acme.length;
    const variance = amounts.reduce((total, value) => total + (value - mean) ** 2, 0) / (amounts.length - 1);
    const rank = 0.95 * (amounts.length - 1);
    const p95 = amounts[Math.floor(rank)]! + (rank % 1) * (amounts[Math.ceil(rank)]! - amounts[Math.floor(rank)]!);
    expect(Number(row!.p95)).toBeCloseTo(p95, 6);
    expect(Number(row!.variance)).toBeCloseTo(variance, 6);
    expect(Number(row!.spread)).toBeCloseTo(Math.sqrt(variance), 6);
  });

  it('applies measure filters, segments, caller filters and NULLS LAST ordering', async () => {
    const [filtered] = await run({ measures: ['giftOrders', 'regionalOrders'] });
    expect(filtered).toEqual({ giftOrders: '2', regionalOrders: '4' });

    const segment = await run({ dimensions: ['region'], measures: ['revenue'], segments: ['paid'], orderBy: [{ field: 'region', direction: 'asc' }] });
    expect(segment).toEqual([{ region: 'EU', revenue: '1000' }, { region: 'US', revenue: '6600' }]);

    const byStatus = await run({ dimensions: ['status'], measures: ['revenue'], orderBy: [{ field: 'status', direction: 'desc' }] });
    expect(byStatus.map(row => row.status)).toEqual(['shipped', 'refunded', 'paid', null]);

    const filteredRows = await run({
      dimensions: ['status'], measures: ['revenue'],
      filters: [{ field: 'status', operator: 'in', value: ['paid', 'shipped'] }, { field: 'status', operator: 'like', value: '%a%' }],
    });
    expect(filteredRows).toEqual([{ status: 'paid', revenue: '7600' }]);
  });

  it('divides in floating point in derived measures and having', async () => {
    const rows = await run({ dimensions: ['status'], measures: ['averageOrderValue'], orderBy: [{ field: 'averageOrderValue', direction: 'desc' }] });
    const paid = acme.filter(order => order.status === 'paid');
    expect(rows[0]).toEqual({ status: 'paid', averageOrderValue: String(Math.round((sum(paid) / paid.length) * 100) / 100) });

    const having = await run({
      dimensions: ['customerId'], measures: ['revenue', 'averageOrderValue'],
      having: [{ measure: 'averageOrderValue', operator: 'between', value: [1000, 2500] }],
    });
    expect([...having].sort((a, b) => Number(a.customerId) - Number(b.customerId))).toEqual([
      { customerId: 1, revenue: '3500', averageOrderValue: '1750' },
      { customerId: 2, revenue: '4800', averageOrderValue: '2400' },
    ]);
  });

  it('traverses relationships with a single-match join (no fan-out from duplicate keys)', async () => {
    const rows = await run({ dimensions: ['customer.country'], measures: ['revenue', 'customer.customers'], orderBy: [{ field: 'revenue', direction: 'desc' }] });
    expect(rows).toEqual([
      { 'customer.country': 'US', revenue: '4800', 'customer.customers': '1' },
      { 'customer.country': 'DE', revenue: '3500', 'customer.customers': '1' },
      { 'customer.country': 'JP', revenue: '300', 'customer.customers': '1' },
      { 'customer.country': null, revenue: '50', 'customer.customers': '0' },
    ]);
  });

  it('buckets by grain in the query timezone with Sunday weeks', async () => {
    const day = await run({ by: 'day', measures: ['revenue'], timezone: 'America/New_York', filters: [{ field: 'createdAt', operator: 'lt', value: '2026-01-03' }] });
    expect(day).toEqual([
      { period: '2026-01-01 00:00:00', revenue: '3500' },
    ]);
    const week = await run({ by: 'week', measures: ['revenue'] });
    expect(week.map(row => row.period)).toEqual(['2025-12-28', '2026-01-04', '2026-02-08', '2026-03-01']);
    const instant = await run({ measures: ['revenue'], filters: [{ field: 'createdAt', operator: 'gte', value: '2026-03-01T23:00:00Z' }], timezone: 'Asia/Tokyo' });
    expect(instant).toEqual([{ revenue: '4100' }]);
  });

  it('refuses raw SQL that only a ClickHouse lexer reads as one literal', async () => {
    // ClickHouse treats \' as an escaped quote, so this is one string there.
    // Under Postgres standard strings 'a\' closes, and the DELETE is code.
    const Evil = dataset('evil', {
      source: `${SCHEMA}.orders`,
      dimensions: { x: dimension.string({ sql: "status || 'a\\'; DELETE FROM analytics.orders; SELECT '", dependencies: ['status'] }) },
      measures: { n: measure.count('x') },
    });
    await expect(client.execute(Evil, { dimensions: ['x'], measures: ['n'] } as never)).rejects.toThrow(/sql/i);
    expect((await pool.query(`SELECT count(*) AS n FROM ${SCHEMA}.orders`)).rows[0].n).toBe(String(ORDERS.length));
  });
});

describe.skipIf(!url)('pg driver', () => {
  let pool: pg.Pool;
  beforeAll(() => { pool = new pg.Pool({ connectionString: url, max: 2 }); });
  afterAll(async () => { await pool?.end(); });

  it('runs statements read-only and one at a time', async () => {
    const driver = createPgDriver({ pool });
    // Only a query reaches the cursor; a SELECT that writes meets the read-only transaction.
    await expect(driver.query('CREATE TABLE should_not_exist (a int)', [])).rejects.toThrow(/syntax error/);
    await pool.query('CREATE SEQUENCE IF NOT EXISTS hq_ro_probe');
    await expect(driver.query("SELECT nextval('hq_ro_probe')", [])).rejects.toThrow(/read-only/);
    await pool.query('DROP SEQUENCE hq_ro_probe');
    await expect(driver.query('SELECT 1; SELECT 2', [])).rejects.toThrow(/multiple commands|cannot insert multiple/);
    expect(await driver.query("SELECT current_setting('TimeZone') AS tz, $1::int AS n", [7])).toEqual([{ tz: 'UTC', n: 7 }]);
  });

  it('returns arrays, numerics, uuids and timestamps in the ClickHouse result shape', async () => {
    const driver = createPgDriver({ pool });
    const [row] = await driver.query<Record<string, unknown>>(
      `SELECT ARRAY[1, 2]::int[] AS ints, ARRAY['a b', 'c"d', NULL]::text[] AS texts, 12.50::numeric AS amount,
        '00000000-0000-0000-0000-000000000001'::uuid AS id, '2026-01-02 10:05:07.5+00'::timestamptz AS at,
        '{"k": [1]}'::jsonb AS doc, 9007199254740993::bigint AS big`,
      [],
    );
    expect(row).toEqual({
      ints: [1, 2], texts: ['a b', 'c"d', null], amount: 12.5,
      id: '00000000-0000-0000-0000-000000000001', at: '2026-01-02 10:05:07.5',
      doc: { k: [1] }, big: '9007199254740993',
    });
  });

  it('refuses a result beyond the row ceiling and anything but a query', async () => {
    const driver = createPgDriver({ pool, maxRows: 3 });
    expect(await driver.query('SELECT g FROM generate_series(1, 3) g ORDER BY g DESC', [])).toEqual([{ g: 3 }, { g: 2 }, { g: 1 }]);
    await expect(driver.query('SELECT g FROM generate_series(1, 4) g', [])).rejects.toThrow(/exceeds 3 rows/);
    await expect(driver.query('DELETE FROM pg_class', [])).rejects.toThrow();
    expect(() => createPgDriver({ pool, maxRows: 0 })).toThrow(/maxRows/);
  });

  it('pins search_path when asked, with pg_catalog first and pg_temp last', async () => {
    await pool.query('DROP SCHEMA IF EXISTS "Search Path" CASCADE');
    await pool.query('CREATE SCHEMA "Search Path"');
    await pool.query(`CREATE TABLE "Search Path".t AS SELECT 'pinned' AS v`);
    try {
      const pinned = createPgDriver({ pool, searchPath: ['Search Path'] });
      expect(await pinned.query('SELECT v FROM t', [])).toEqual([{ v: 'pinned' }]);
      expect(await pinned.query("SELECT current_setting('search_path') AS p", []))
        .toEqual([{ p: 'pg_catalog, "Search Path", pg_temp' }]);
      // Unpinned, the session's own search_path applies and the table isn't found.
      await expect(createPgDriver({ pool }).query('SELECT v FROM t', [])).rejects.toThrow(/does not exist/);
      expect(() => createPgDriver({ pool, searchPath: ['pg_catalog'] })).toThrow(/placed automatically/);
    } finally {
      await pool.query('DROP SCHEMA "Search Path" CASCADE');
    }
  });

  it('enforces the statement timeout and cancels on abort', async () => {
    await expect(createPgDriver({ pool, statementTimeoutMs: 50 }).query('SELECT pg_sleep(2)', [])).rejects.toThrow(/statement timeout/);
    const controller = new AbortController();
    const started = Date.now();
    const pending = createPgDriver({ pool }).query('SELECT pg_sleep(5)', [], { abortSignal: controller.signal });
    setTimeout(() => controller.abort(new Error('stop')), 100);
    await expect(pending).rejects.toThrow('stop');
    expect(Date.now() - started).toBeLessThan(2_000);
    // The pool is still usable afterwards.
    expect(await createPgDriver({ pool }).query('SELECT 1 AS one', [])).toEqual([{ one: 1 }]);
  });
});

interface PeriodCase { grain: TimeGrain; timezone: string; instant: string; period: string }
const periodCases = (JSON.parse(readFileSync(
  fileURLToPath(new URL('../../../../../specs/datasets/period-format-v1.json', import.meta.url)), 'utf8',
)) as { cases: PeriodCase[] }).cases;

describe.skipIf(!url)('period format (RFC 0015 fixture)', () => {
  let pool: pg.Pool;
  const Events = dataset('events', {
    source: 'period_cases.events',
    timeKey: 'at',
    dimensions: { at: dimension.timestamp() },
    measures: { n: measure.count('at') },
  });

  beforeAll(async () => {
    pool = new pg.Pool({ connectionString: url, max: 2 });
    await pool.query('DROP SCHEMA IF EXISTS period_cases CASCADE');
    await pool.query('CREATE SCHEMA period_cases');
    await pool.query('CREATE TABLE period_cases.events (at timestamptz)');
  });
  afterAll(async () => {
    await pool?.query('DROP SCHEMA IF EXISTS period_cases CASCADE');
    await pool?.end();
  });

  it.each(periodCases.map(c => [`${c.grain} ${c.timezone} ${c.instant}`, c] as const))('%s', async (_name, c) => {
    await pool.query('TRUNCATE period_cases.events');
    await pool.query('INSERT INTO period_cases.events VALUES ($1)', [c.instant]);
    const client = createDatasetClient({ queryBuilder: createPostgresQueryBuilder({ pool }) });
    const result = await client.execute(Events, { by: c.grain, measures: ['n'], timezone: c.timezone } as never);
    expect((result.data as Record<string, unknown>[])[0]?.period).toBe(c.period);
  });
});
