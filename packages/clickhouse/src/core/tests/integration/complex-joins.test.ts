// @ts-nocheck
import {
  initializeTestConnection,
  setupTestDatabase,
  TEST_DATA
} from './setup';
import { ClickHouseConnection } from '../../connection.js';
import { createQueryBuilder } from '../../../index.js';
import { TestSchemaType } from './setup.js';

// Skip integration tests if running in CI or if explicitly disabled
const SKIP_INTEGRATION_TESTS = process.env.SKIP_INTEGRATION_TESTS === 'true' || process.env.CI === 'true';

// Define types for our query results
interface OrderUserResult {
  order_id: number;
  total: number;
  order_status: string;
  user_name: string;
  email: string;
}

interface OrderProductResult {
  order_id: number;
  quantity: number;
  total: number;
  product_name: string;
  product_price: number;
}

interface OrderUserProductResult {
  order_id: number;
  user_name: string;
  product_name: string;
  quantity: number;
  total: number;
  order_status: string;
}

interface UserOrdersResult {
  user_id: number;
  user_name: string;
  order_count: number;
  total_spent: number;
}

interface FilteredJoinResult {
  order_id: number;
  user_name: string;
  product_name: string;
  total: number;
}

interface UserSubqueryResult {
  user_id: number;
  user_name: string;
  user_status: string;
  completed_orders: number;
  total_spent: number;
}

interface WindowFunctionResult {
  order_id: number;
  user_name: string;
  total: number;
  created_at: string;
  running_total: number;
}

describe('Integration Tests - Complex Joins', () => {
  // Only run these tests if not skipped
  (SKIP_INTEGRATION_TESTS ? describe.skip : describe)('ClickHouse Integration', () => {
    let db: Awaited<ReturnType<typeof initializeTestConnection>>;

    beforeAll(async () => {
      if (!SKIP_INTEGRATION_TESTS) {
        try {
          // Setup only - don't start/stop container (handled by shell script)
          db = await initializeTestConnection();
          await setupTestDatabase();
        } catch (error) {
          console.error('Failed to set up integration tests:', error);
          throw error;
        }
      }
    }, 30000);

    test('should join orders with users', async () => {
      const result = await db
        .table('orders')
        .select([
          'orders.id as order_id',
          'orders.total',
          'orders.status as order_status',
          'users.user_name',
          'users.email'
        ])
        .innerJoin('users', 'user_id', 'users.id')
        .orderBy('orders.id', 'ASC')
        .execute();

      expect(result).toHaveLength(TEST_DATA.orders.length);

      // Verify join worked correctly
      for (const row of result) {
        const order = TEST_DATA.orders.find(o => o.id === Number(row.order_id));
        const user = TEST_DATA.users.find(u => u.id === order?.user_id);

        expect(Number(row.total)).toBeCloseTo(order?.total || 0, 2);
        expect(row.order_status).toBe(order?.status);
        expect(row.user_name).toBe(user?.user_name);
        expect(row.email).toBe(user?.email);
      }
    });

    test('should join orders with products', async () => {
      const result = await db
        .table('orders')
        .select([
          'orders.id as order_id',
          'orders.quantity',
          'orders.total',
          'test_table.name as product_name',
          'test_table.price as product_price'
        ])
        .innerJoin('test_table', 'product_id', 'test_table.id')
        .orderBy('orders.id', 'ASC')
        .execute();

      expect(result).toHaveLength(TEST_DATA.orders.length);

      // Verify join worked correctly
      for (const row of result) {
        const order = TEST_DATA.orders.find(o => o.id === Number(row.order_id));
        const product = TEST_DATA.test_table.find(p => p.id === order?.product_id);

        expect(Number(row.quantity)).toBe(order?.quantity);
        expect(Number(row.total)).toBeCloseTo(order?.total || 0, 2);
        expect(row.product_name).toBe(product?.name);
        expect(Number(row.product_price)).toBeCloseTo(product?.price || 0, 2);
      }
    });

    test('should perform a three-way join between orders, users, and products', async () => {
      const result = await db
        .table('orders')
        .select([
          'orders.id as order_id',
          'users.user_name',
          'test_table.name as product_name',
          'orders.quantity',
          'orders.total',
          'orders.status as order_status'
        ])
        .innerJoin('users', 'user_id', 'users.id')
        .innerJoin('test_table', 'product_id', 'test_table.id')
        .orderBy('orders.id', 'ASC')
        .execute();

      expect(result).toHaveLength(TEST_DATA.orders.length);

      // Verify three-way join worked correctly
      for (const row of result) {
        const order = TEST_DATA.orders.find(o => o.id === Number(row.order_id));
        const user = TEST_DATA.users.find(u => u.id === order?.user_id);
        const product = TEST_DATA.test_table.find(p => p.id === order?.product_id);

        expect(row.user_name).toBe(user?.user_name);
        expect(row.product_name).toBe(product?.name);
        expect(Number(row.quantity)).toBe(order?.quantity);
        expect(Number(row.total)).toBeCloseTo(order?.total || 0, 2);
        expect(row.order_status).toBe(order?.status);
      }
    });

    test('should perform aggregations with joins', async () => {
      const result = await db
        .table('users')
        .select([
          'users.id as user_id',
          'users.user_name'
        ])
        .leftJoin('orders', 'id', 'orders.user_id')
        .count('orders.id', 'order_count')
        .sum('orders.total', 'total_spent')
        .groupBy(['users.id', 'users.user_name'])
        .orderBy('users.id', 'ASC')
        .execute();

      expect(result).toHaveLength(TEST_DATA.users.length);

      // Verify aggregations
      for (const row of result) {
        const userOrders = TEST_DATA.orders.filter(o => o.user_id === Number(row.user_id));
        const expectedOrderCount = userOrders.length;
        const expectedTotalSpent = userOrders.reduce((sum, order) => sum + order.total, 0);

        expect(Number(row.order_count)).toBe(expectedOrderCount);
        expect(Number(row.total_spent)).toBeCloseTo(expectedTotalSpent, 2);
      }
    });

    test('should filter joined data with WHERE clauses', async () => {
      const result = await db
        .table('orders')
        .select([
          'orders.id as order_id',
          'users.user_name',
          'test_table.name as product_name',
          'orders.total'
        ])
        .innerJoin('users', 'user_id', 'users.id')
        .innerJoin('test_table', 'product_id', 'test_table.id')
        .where('orders.status', 'eq', 'completed')
        .where('test_table.category', 'eq', 'A')
        .orderBy('orders.id', 'ASC')
        .execute();

      // Calculate expected results manually
      const expectedResults = TEST_DATA.orders
        .filter(o =>
          o.status === 'completed' &&
          TEST_DATA.test_table.find(p => p.id === o.product_id)?.category === 'A'
        );

      expect(result).toHaveLength(expectedResults.length);

      // Verify filtered results
      for (const row of result) {
        const order = TEST_DATA.orders.find(o => o.id === Number(row.order_id));
        const user = TEST_DATA.users.find(u => u.id === order?.user_id);
        const product = TEST_DATA.test_table.find(p => p.id === order?.product_id);

        expect(row.user_name).toBe(user?.user_name);
        expect(row.product_name).toBe(product?.name);
        expect(Number(row.total)).toBeCloseTo(order?.total || 0, 2);
        expect(order?.status).toBe('completed');
        expect(product?.category).toBe('A');
      }
    });

    test('should work with subqueries using withCTE', async () => {
      // First create a subquery for completed orders
      const completedOrdersQuery = db
        .table('orders')
        .select(['user_id'])
        .count('id', 'completed_count')
        .sum('total', 'total_spent')
        .where('status', 'eq', 'completed')
        .groupBy('user_id');

      // Then use it in the main query
      const result = await db
        .table('users')
        .select([
          'users.id as user_id',
          'users.user_name',
          'users.status as user_status',
          'completed_orders.completed_count as completed_orders',
          'completed_orders.total_spent'
        ])
        .withCTE('completed_orders', completedOrdersQuery)
        .leftJoin('completed_orders', 'id', 'completed_orders.user_id')
        .orderBy('users.id', 'ASC')
        .execute();

      expect(result).toHaveLength(TEST_DATA.users.length);

      // Verify results
      for (const row of result) {
        const userId = Number(row.user_id);
        const completedOrders = TEST_DATA.orders.filter(o =>
          o.user_id === userId && o.status === 'completed'
        );

        const expectedCompletedCount = completedOrders.length;
        const expectedTotalSpent = completedOrders.reduce((sum, order) => sum + order.total, 0);

        // Check if we have any completed orders
        if (expectedCompletedCount > 0) {
          expect(Number(row.completed_orders)).toBe(expectedCompletedCount);
          expect(Number(row.total_spent)).toBeCloseTo(expectedTotalSpent, 2);
        } else {
          // If no completed orders, the value might be null or 0 depending on the LEFT JOIN behavior
          expect([null, 0, '0'].includes(row.completed_orders)).toBeTruthy();
        }
      }
    });

    test('should handle complex filtering and aggregation in joined queries', async () => {
      const result = await db
        .table('users')
        .select(['users.id as user_id', 'users.user_name'])
        .innerJoin('orders', 'users.id', 'orders.user_id')
        .innerJoin('test_table', 'orders.product_id', 'test_table.id')
        .avg('test_table.price', 'avg_product_price')
        .count('orders.id', 'order_count')
        .where('users.status', 'eq', 'active')
        .where('orders.total', 'gt', 20)
        .groupBy(['users.id', 'users.user_name'])
        .having('order_count > 0')
        .orderBy('avg_product_price', 'DESC')
        .execute();

      // Calculate expected results manually
      const activeUsers = TEST_DATA.users.filter(u => u.status === 'active');

      const userStats = activeUsers.map(user => {
        const validOrders = TEST_DATA.orders.filter(o =>
          o.user_id === user.id && o.total > 20
        );

        const orderCount = validOrders.length;

        if (orderCount === 0) return null;

        const productPrices = validOrders.map(order => {
          const product = TEST_DATA.test_table.find(p => p.id === order.product_id);
          return product?.price || 0;
        });

        const avgProductPrice = productPrices.reduce((sum, price) => sum + price, 0) / productPrices.length;

        return {
          user_id: user.id,
          user_name: user.user_name,
          order_count: orderCount,
          avg_product_price: avgProductPrice
        };
      }).filter(Boolean)
        .sort((a, b) => b.avg_product_price - a.avg_product_price);

      expect(result.length).toBe(userStats.length);

      // Verify results match our manual calculation
      for (let i = 0; i < result.length; i++) {
        const row = result[i];
        const expected = userStats[i];

        expect(Number(row.user_id)).toBe(expected.user_id);
        expect(row.user_name).toBe(expected.user_name);
        expect(Number(row.order_count)).toBe(expected.order_count);
        expect(Number(row.avg_product_price)).toBeCloseTo(expected.avg_product_price, 2);
      }
    });
  });
}); 