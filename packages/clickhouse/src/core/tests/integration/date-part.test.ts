// @ts-nocheck
/**
 * Every `datePart` unit must compile to a function ClickHouse actually has.
 * `day` once emitted `toDay(...)`, which fails with UNKNOWN_FUNCTION, so this
 * runs each unit against a real server instead of comparing SQL strings.
 */
import { ClickHouseConnection } from '../../connection.js';
import { datePart } from '../../utils/sql-expressions.js';
import { initializeTestConnection } from './setup';
import { SKIP_INTEGRATION_TESTS, SETUP_TIMEOUT } from './test-config.js';

const TABLE = 'date_part_events';

describe('Integration Tests - datePart', () => {
  (SKIP_INTEGRATION_TESTS ? describe.skip : describe)('ClickHouse Integration', () => {
    let db: Awaited<ReturnType<typeof initializeTestConnection>>;

    beforeAll(async () => {
      if (SKIP_INTEGRATION_TESTS) return;
      db = await initializeTestConnection();
      const client = ClickHouseConnection.getClient();
      await client.command({ query: `DROP TABLE IF EXISTS ${TABLE}` });
      await client.command({
        query: `CREATE TABLE ${TABLE} (ts DateTime('UTC')) ENGINE = MergeTree ORDER BY ts`,
      });
      await client.command({
        query: `INSERT INTO ${TABLE} VALUES ('2026-11-14 09:05:07')`,
      });
    }, SETUP_TIMEOUT);

    afterAll(async () => {
      if (SKIP_INTEGRATION_TESTS) return;
      await ClickHouseConnection.getClient().command({ query: `DROP TABLE IF EXISTS ${TABLE}` });
    });

    test('extracts every unit from a DateTime', async () => {
      const rows = await db.table(TABLE)
        .select([
          datePart('year', 'ts', 'y'),
          datePart('quarter', 'ts', 'q'),
          datePart('month', 'ts', 'mo'),
          datePart('week', 'ts', 'w'),
          datePart('day', 'ts', 'd'),
          datePart('hour', 'ts', 'h'),
          datePart('minute', 'ts', 'mi'),
          datePart('second', 'ts', 's'),
        ])
        .execute();

      const row = Object.fromEntries(Object.entries(rows[0]).map(([k, v]) => [k, Number(v)]));
      expect(row).toEqual({ y: 2026, q: 4, mo: 11, w: 45, d: 14, h: 9, mi: 5, s: 7 });
    });
  });
});
