// @ts-nocheck
/**
 * A JavaScript Date used as a filter value must work against a DateTime
 * sorting-key column. ClickHouse rejects a quoted ISO string there with
 * TYPE_MISMATCH ("Cannot convert string '...T...Z' to type DateTime"), while
 * the same literal works against a column outside the key, so this runs the
 * queries for real instead of comparing SQL strings.
 */
import { ClickHouseConnection } from '../../connection.js';
import { CrossFilter } from '../../cross-filter.js';
import { initializeTestConnection } from './setup';
import { SKIP_INTEGRATION_TESTS, SETUP_TIMEOUT } from './test-config.js';

const TABLE = 'date_filter_events';

describe('Integration Tests - Date filter values', () => {
  (SKIP_INTEGRATION_TESTS ? describe.skip : describe)('ClickHouse Integration', () => {
    let db: Awaited<ReturnType<typeof initializeTestConnection>>;

    beforeAll(async () => {
      if (SKIP_INTEGRATION_TESTS) return;
      db = await initializeTestConnection();
      const client = ClickHouseConnection.getClient();
      await client.command({ query: `DROP TABLE IF EXISTS ${TABLE}` });
      await client.command({
        query: `CREATE TABLE ${TABLE} (ts DateTime('UTC'), ts_ms DateTime64(3, 'UTC'), day Date, n UInt32)
                ENGINE = MergeTree ORDER BY ts`,
      });
      // One row per minute from 2026-03-01 00:00:00 UTC.
      await client.command({
        query: `INSERT INTO ${TABLE}
                SELECT toDateTime('2026-03-01 00:00:00', 'UTC') + number * 60,
                       addMilliseconds(toDateTime64('2026-03-01 00:00:00', 3, 'UTC') + number * 60, 500),
                       toDate(toDateTime('2026-03-01 00:00:00', 'UTC') + number * 60),
                       number
                FROM numbers(180)`,
      });
    }, SETUP_TIMEOUT);

    afterAll(async () => {
      if (SKIP_INTEGRATION_TESTS) return;
      await ClickHouseConnection.getClient().command({ query: `DROP TABLE IF EXISTS ${TABLE}` });
    });

    const count = (rows: Array<{ c: string | number }>) => Number(rows[0].c);

    test('filters a DateTime sorting-key column with a Date', async () => {
      const rows = await db.table(TABLE)
        .count('n', 'c')
        .where('ts', 'gte', new Date('2026-03-01T01:00:00.000Z'))
        .where('ts', 'lt', new Date('2026-03-01T02:00:00.000Z'))
        .execute();
      expect(count(rows)).toBe(60);
    });

    test('compares a sub-second Date with a DateTime sorting-key column', async () => {
      const rows = await db.table(TABLE)
        .count('n', 'c')
        .where('ts', 'gt', new Date('2026-03-01T00:59:59.500Z'))
        .where('ts', 'lte', new Date('2026-03-01T01:00:00.000Z'))
        .execute();
      expect(count(rows)).toBe(1);
    });

    test('matches Dates in an IN list and with between', async () => {
      const inRows = await db.table(TABLE)
        .count('n', 'c')
        .where('ts', 'in', [new Date('2026-03-01T00:00:00Z'), new Date('2026-03-01T00:01:00Z')])
        .execute();
      expect(count(inRows)).toBe(2);

      const betweenRows = await db.table(TABLE)
        .count('n', 'c')
        .where('ts', 'between', [new Date('2026-03-01T00:00:00Z'), new Date('2026-03-01T00:09:00Z')])
        .execute();
      expect(count(betweenRows)).toBe(10);
    });

    test('keeps millisecond precision against a DateTime64 column', async () => {
      const rows = await db.table(TABLE)
        .count('n', 'c')
        .where('ts_ms', 'eq', new Date('2026-03-01T00:00:00.500Z'))
        .execute();
      expect(count(rows)).toBe(1);
    });

    test('compares a Date column with a Date value', async () => {
      const rows = await db.table(TABLE)
        .count('n', 'c')
        .where('day', 'eq', new Date('2026-03-01T00:00:00Z'))
        .execute();
      expect(count(rows)).toBe(180);
    });

    test('applies a CrossFilter Date condition on the sorting key', async () => {
      const filter = new CrossFilter().add({
        column: 'ts',
        operator: 'gte',
        value: new Date('2026-03-01T02:00:00Z'),
      });
      const rows = await db.table(TABLE).count('n', 'c').applyCrossFilters(filter).execute();
      expect(count(rows)).toBe(60);
    });

    test('binds Dates in rawQuery placeholders', async () => {
      const rows = await db.rawQuery(
        `SELECT count() AS c FROM ${TABLE} WHERE ts >= ? AND ts < ?`,
        [new Date('2026-03-01T00:30:00Z'), new Date('2026-03-01T00:40:00Z')],
      );
      expect(count(rows)).toBe(10);
    });
  });
});
