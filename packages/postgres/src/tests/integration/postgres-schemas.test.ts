/**
 * Real Postgres schemas: mixed-case and reserved identifiers, time keys of
 * every type, and time filters that keep the time-key index usable.
 */
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { belongsTo, createDatasetClient, dataset, dimension, measure } from '@hypequery/datasets';
import { createPostgresQueryBuilder } from '../../index.js';

const url = process.env.POSTGRES_URL;
const SCHEMA = 'HqCase';

describe.skipIf(!url)('Postgres schemas', () => {
  let pool: pg.Pool;
  let client: ReturnType<typeof createDatasetClient>;

  beforeAll(async () => {
    pool = new pg.Pool({ connectionString: url, max: 2 });
    await pool.query(`DROP SCHEMA IF EXISTS "${SCHEMA}" CASCADE`);
    await pool.query(`CREATE SCHEMA "${SCHEMA}"`);
    await pool.query(`CREATE TABLE "${SCHEMA}"."Events" ("eventId" int, "tenantId" text, "user" text, "userId" int,
      "Amount" bigint, "createdAt" timestamptz, "onDay" date, "atUtc" timestamp)`);
    await pool.query(`CREATE TABLE "${SCHEMA}"."Users" ("userId" int, "tenantId" text, "Country" text)`);
    const events = [
      [1, 'a', 'ann', 1, 100, '2026-01-01T12:00:00Z'],
      [2, 'a', 'bob', 2, 200, '2026-01-02T03:00:00Z'], // 2026-01-01 22:00 in New York
      [3, 'a', 'ann', 1, 300, '2026-01-02T12:00:00Z'],
      [4, 'a', 'cat', 3, 400, '2026-01-04T12:00:00Z'],
      [5, 'b', 'zed', 9, 9999, '2026-01-02T12:00:00Z'],
    ] as const;
    for (const [id, tenant, user, userId, amount, at] of events) {
      // onDay and atUtc carry the same reading as createdAt in their own types.
      await pool.query(
        `INSERT INTO "${SCHEMA}"."Events" VALUES ($1, $2, $3, $4, $5, $6::timestamptz, ($6::timestamptz AT TIME ZONE 'UTC')::date, $6::timestamptz AT TIME ZONE 'UTC')`,
        [id, tenant, user, userId, amount, at],
      );
    }
    await pool.query(`INSERT INTO "${SCHEMA}"."Users" VALUES (1, 'a', 'DE'), (2, 'a', 'US'), (3, 'a', 'JP'), (9, 'b', 'FR')`);
    await pool.query(`CREATE INDEX "Events_createdAt" ON "${SCHEMA}"."Events" ("createdAt")`);
    client = createDatasetClient({ queryBuilder: createPostgresQueryBuilder({ pool }) });
  });

  afterAll(async () => {
    await pool?.query(`DROP SCHEMA IF EXISTS "${SCHEMA}" CASCADE`);
    await pool?.end();
  });

  const Users = dataset('users', {
    source: `${SCHEMA}.Users`,
    tenantKey: 'tenantId',
    dimensions: { userId: dimension.number(), country: dimension.string({ column: 'Country' }) },
    measures: { users: measure.countDistinct('userId') },
  });

  const events = (timeColumn: string) => dataset('events', {
    source: `${SCHEMA}.Events`,
    tenantKey: 'tenantId',
    timeKey: 'at',
    dimensions: {
      at: dimension.timestamp({ column: timeColumn }),
      user: dimension.string(),
      userId: dimension.number(),
      amount: dimension.number({ column: 'Amount', groupable: false }),
    },
    measures: {
      revenue: measure.sum('amount'),
      rolling: measure.trailing('revenue', { amount: 2, unit: 'day' }),
    },
    filters: { at: { __type: 'filter_definition', field: 'at', operators: ['gte', 'lt', 'between'] } },
    relationships: { primaryUser: belongsTo(() => Users, { from: 'userId', to: 'userId' }) },
  });
  const tenant = { runtime: { tenant: { id: 'a' } } };
  const run = async (ds: ReturnType<typeof events>, query: object) =>
    (await client.execute(ds, query as never, tenant as never)).data as Record<string, unknown>[];

  it('keeps mixed-case and reserved identifiers, including a camelCase relationship', async () => {
    const Events = events('createdAt');
    expect(await run(Events, { dimensions: ['user'], measures: ['revenue'], orderBy: [{ field: 'user', direction: 'asc' }] })).toEqual([
      { user: 'ann', revenue: '400' }, { user: 'bob', revenue: '200' }, { user: 'cat', revenue: '400' },
    ]);
    expect(await run(Events, {
      dimensions: ['primaryUser.country'], measures: ['revenue', 'primaryUser.users'],
      orderBy: [{ field: 'primaryUser.country', direction: 'asc' }],
    })).toEqual([
      { 'primaryUser.country': 'DE', revenue: '400', 'primaryUser.users': '1' },
      { 'primaryUser.country': 'JP', revenue: '400', 'primaryUser.users': '1' },
      { 'primaryUser.country': 'US', revenue: '200', 'primaryUser.users': '1' },
    ]);
    expect(await run(Events, {
      by: 'day', measures: ['revenue', 'rolling'], timezone: 'America/New_York',
      filters: [{ field: 'at', operator: 'between', value: ['2026-01-01', '2026-01-03'] }],
    })).toEqual([
      { period: '2026-01-01 00:00:00', revenue: '300', rolling: '300' },
      { period: '2026-01-02 00:00:00', revenue: '300', rolling: '600' },
      { period: '2026-01-03 00:00:00', revenue: null, rolling: '300' },
    ]);
  });

  it.each([
    // A timestamptz key: the New York day starts at 05:00Z, leaving rows 3 and 4.
    ['timestamptz', 'createdAt', '700'],
    // A zone-less timestamp is read as UTC, so it matches timestamptz.
    ['zone-less timestamp', 'atUtc', '700'],
    // A date holds local dates: every 2026-01-02 row counts, whatever the zone.
    ['date', 'onDay', '900'],
  ])('filters a %s time key in the query zone', async (_type, column, revenue) => {
    expect(await run(events(column), {
      measures: ['revenue'], timezone: 'America/New_York',
      filters: [{ field: 'at', operator: 'gte', value: '2026-01-02' }],
    })).toEqual([{ revenue }]);
  });

  it('compares the bare time column, so its index applies', async () => {
    const compilation = client.compileDataset(events('createdAt'), {
      measures: ['revenue'], timezone: 'America/New_York',
      filters: [{ field: 'at', operator: 'gte', value: '2026-01-02' }, { field: 'at', operator: 'lt', value: '2026-01-03T00:00:00Z' }],
    } as never, tenant as never);
    const connection = await pool.connect();
    try {
      await connection.query('SET enable_seqscan = off');
      const { rows } = await connection.query(`EXPLAIN ${compilation.sql}`, [...compilation.parameters]);
      const plan = rows.map(row => row['QUERY PLAN']).join('\n');
      expect(plan).toMatch(/Index (Only )?Scan using "Events_createdAt"|Bitmap Index Scan on "Events_createdAt"/);
      expect(plan).toMatch(/Index Cond: .*"createdAt" >= /);
    } finally {
      await connection.query('RESET enable_seqscan');
      connection.release();
    }
  });
});
