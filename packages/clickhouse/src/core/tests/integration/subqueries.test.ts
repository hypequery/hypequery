// @ts-nocheck
import { rawAs } from '../../../index.js';
import {
  initializeTestConnection,
  setupTestDatabase,
  TEST_DATA,
} from './setup.js';
import { SKIP_INTEGRATION_TESTS, SETUP_TIMEOUT } from './test-config.js';

describe('Integration Tests - Subqueries', () => {
  (SKIP_INTEGRATION_TESTS ? describe.skip : describe)('ClickHouse Integration', () => {
    let db: Awaited<ReturnType<typeof initializeTestConnection>>;

    beforeAll(async () => {
      db = await initializeTestConnection();
      await setupTestDatabase();
    }, SETUP_TIMEOUT);

    test('executes a typed aggregate subquery in the FROM clause', async () => {
      const totalsByProduct = db.table('orders')
        .where('created_at', 'gte', '2023-01-10')
        .select([
          'user_id',
          'product_id',
          rawAs<string, 'sum_value'>('SUM(total - 30)', 'sum_value'),
        ])
        .groupBy(['user_id', 'product_id']);

      const query = db.from(totalsByProduct)
        .select([
          'user_id',
          rawAs<string, 'negative_sum_value'>(
            'sumIf(sum_value, sum_value < 0)',
            'negative_sum_value',
          ),
          rawAs<string, 'positive_sum_value'>(
            'sumIf(sum_value, sum_value > 0)',
            'positive_sum_value',
          ),
        ])
        .groupBy('user_id')
        .orderBy('user_id', 'ASC');

      expect(query.toSQLWithParams()).toEqual({
        sql:
          'SELECT user_id, ' +
          'sumIf(sum_value, sum_value < 0) AS negative_sum_value, ' +
          'sumIf(sum_value, sum_value > 0) AS positive_sum_value ' +
          'FROM (SELECT user_id, product_id, SUM(total - 30) AS sum_value ' +
          'FROM orders WHERE created_at >= ? GROUP BY user_id, product_id) ' +
          'GROUP BY user_id ORDER BY user_id ASC',
        parameters: ['2023-01-10'],
      });

      const result = await query.execute();
      const productTotals = TEST_DATA.orders
        .filter(order => order.created_at >= '2023-01-10')
        .reduce((byProduct, order) => {
          const key = `${order.user_id}:${order.product_id}`;
          const current = byProduct.get(key) ?? {
            user_id: order.user_id,
            sum_value: 0,
          };
          current.sum_value += order.total - 30;
          byProduct.set(key, current);
          return byProduct;
        }, new Map());

      const expected = Array.from(productTotals.values())
        .reduce((byUser, productTotal) => {
          const current = byUser.get(productTotal.user_id) ?? {
            user_id: productTotal.user_id,
            negative_sum_value: 0,
            positive_sum_value: 0,
          };
          if (productTotal.sum_value < 0) {
            current.negative_sum_value += productTotal.sum_value;
          } else if (productTotal.sum_value > 0) {
            current.positive_sum_value += productTotal.sum_value;
          }
          byUser.set(productTotal.user_id, current);
          return byUser;
        }, new Map());

      const expectedRows = Array.from(expected.values())
        .sort((left, right) => left.user_id - right.user_id);

      expect(result.map(row => ({
        user_id: Number(row.user_id),
        negative_sum_value: Number(row.negative_sum_value),
        positive_sum_value: Number(row.positive_sum_value),
      }))).toEqual(expectedRows);
    });

    test('applies settings inherited from the nested query', async () => {
      const configured = db.table('orders')
        .settings({ max_threads: 23 })
        .select([
          rawAs<string, 'configured_max_threads'>(
            "getSetting('max_threads')",
            'configured_max_threads',
          ),
        ])
        .limit(1);

      const result = await db.from(configured)
        .select(['configured_max_threads'])
        .execute();

      expect(result.map(row => Number(row.configured_max_threads))).toEqual([23]);
    });
  });
});
