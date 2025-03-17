import {
  initializeTestConnection,
  setupTestDatabase,
  startClickHouseContainer,
  stopClickHouseContainer,
  TestSchema,
  TEST_DATA
} from './setup';
import { ClickHouseConnection } from '../../connection';

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
          // Start ClickHouse container
          startClickHouseContainer();

          // Initialize connection
          db = await initializeTestConnection();

          // Set up test database
          await setupTestDatabase();
        } catch (error) {
          console.error('Failed to set up integration tests:', error);
          throw error;
        }
      }
    }, 60000); // Allow up to 60 seconds for setup

    afterAll(() => {
      if (!SKIP_INTEGRATION_TESTS) {
        stopClickHouseContainer();
      }
    });

    test('should join orders with users', async () => {
      const query = `
        SELECT 
          o.id as order_id, 
          o.total, 
          o.status as order_status, 
          u.user_name, 
          u.email
        FROM orders o
        JOIN users u ON o.user_id = u.id
        ORDER BY o.id ASC
      `;

      const client = ClickHouseConnection.getClient();
      const result = await client.query({
        query,
        format: 'JSONEachRow'
      }).then(res => res.json()) as OrderUserResult[];

      expect(result).toHaveLength(TEST_DATA.orders.length);

      // Verify join worked correctly
      for (const row of result) {
        const order = TEST_DATA.orders.find(o => o.id === row.order_id);
        const user = TEST_DATA.users.find(u => u.id === order?.user_id);

        expect(Number(row.total)).toBeCloseTo(order?.total || 0, 2);
        expect(row.order_status).toBe(order?.status);
        expect(row.user_name).toBe(user?.user_name);
        expect(row.email).toBe(user?.email);
      }
    });

    test('should join orders with products', async () => {
      const query = `
        SELECT 
          o.id as order_id, 
          o.quantity, 
          o.total, 
          p.name as product_name, 
          p.price as product_price
        FROM orders o
        JOIN test_table p ON o.product_id = p.id
        ORDER BY o.id ASC
      `;

      const client = ClickHouseConnection.getClient();
      const result = await client.query({
        query,
        format: 'JSONEachRow'
      }).then(res => res.json()) as OrderProductResult[];

      expect(result).toHaveLength(TEST_DATA.orders.length);

      // Verify join worked correctly
      for (const row of result) {
        const order = TEST_DATA.orders.find(o => o.id === row.order_id);
        const product = TEST_DATA.test_table.find(p => p.id === order?.product_id);

        expect(Number(row.quantity)).toBe(order?.quantity);
        expect(Number(row.total)).toBeCloseTo(order?.total || 0, 2);
        expect(row.product_name).toBe(product?.name);
        expect(Number(row.product_price)).toBeCloseTo(product?.price || 0, 2);
      }
    });

    test('should perform a three-way join between orders, users, and products', async () => {
      const query = `
        SELECT 
          o.id as order_id, 
          u.user_name, 
          p.name as product_name, 
          o.quantity, 
          o.total, 
          o.status as order_status
        FROM orders o
        JOIN users u ON o.user_id = u.id
        JOIN test_table p ON o.product_id = p.id
        ORDER BY o.id ASC
      `;

      const client = ClickHouseConnection.getClient();
      const result = await client.query({
        query,
        format: 'JSONEachRow'
      }).then(res => res.json()) as OrderUserProductResult[];

      expect(result).toHaveLength(TEST_DATA.orders.length);

      // Verify three-way join worked correctly
      for (const row of result) {
        const order = TEST_DATA.orders.find(o => o.id === row.order_id);
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
      const query = `
        SELECT 
          u.id as user_id,
          u.user_name,
          COUNT(o.id) as order_count,
          SUM(o.total) as total_spent
        FROM users u
        LEFT JOIN orders o ON u.id = o.user_id
        GROUP BY u.id, u.user_name
        ORDER BY u.id ASC
      `;

      const client = ClickHouseConnection.getClient();
      const result = await client.query({
        query,
        format: 'JSONEachRow'
      }).then(res => res.json()) as UserOrdersResult[];

      expect(result).toHaveLength(TEST_DATA.users.length);

      // Verify aggregations
      for (const row of result) {
        const userOrders = TEST_DATA.orders.filter(o => o.user_id === row.user_id);
        const expectedOrderCount = userOrders.length;
        const expectedTotalSpent = userOrders.reduce((sum, order) => sum + order.total, 0);

        expect(Number(row.order_count)).toBe(expectedOrderCount);
        expect(Number(row.total_spent)).toBeCloseTo(expectedTotalSpent, 2);
      }
    });

    test('should filter joined data with WHERE clauses', async () => {
      const query = `
        SELECT 
          o.id as order_id, 
          u.user_name, 
          p.name as product_name, 
          o.total
        FROM orders o
        JOIN users u ON o.user_id = u.id
        JOIN test_table p ON o.product_id = p.id
        WHERE o.status = 'completed' AND p.category = 'A'
        ORDER BY o.id ASC
      `;

      const client = ClickHouseConnection.getClient();
      const result = await client.query({
        query,
        format: 'JSONEachRow'
      }).then(res => res.json()) as FilteredJoinResult[];

      // Calculate expected results manually
      const expectedResults = TEST_DATA.orders
        .filter(o =>
          o.status === 'completed' &&
          TEST_DATA.test_table.find(p => p.id === o.product_id)?.category === 'A'
        );

      expect(result).toHaveLength(expectedResults.length);

      // Verify filtered results
      for (const row of result) {
        const order = TEST_DATA.orders.find(o => o.id === row.order_id);
        const product = TEST_DATA.test_table.find(p => p.id === order?.product_id);

        expect(order?.status).toBe('completed');
        expect(product?.category).toBe('A');
      }
    });

    test('should perform subqueries with joins', async () => {
      const query = `
        SELECT 
          u.id as user_id,
          u.user_name,
          u.status as user_status,
          (
            SELECT COUNT(*)
            FROM orders o
            WHERE o.user_id = u.id AND o.status = 'completed'
          ) as completed_orders,
          (
            SELECT SUM(o.total)
            FROM orders o
            WHERE o.user_id = u.id
          ) as total_spent
        FROM users u
        WHERE u.status = 'active'
        ORDER BY u.id ASC
      `;

      const client = ClickHouseConnection.getClient();
      const result = await client.query({
        query,
        format: 'JSONEachRow'
      }).then(res => res.json()) as UserSubqueryResult[];

      // Calculate expected results manually
      const activeUsers = TEST_DATA.users.filter(u => u.status === 'active');

      expect(result).toHaveLength(activeUsers.length);

      // Verify subquery results
      for (const row of result) {
        const userId = row.user_id;
        const completedOrders = TEST_DATA.orders.filter(o =>
          o.user_id === userId && o.status === 'completed'
        );
        const totalSpent = TEST_DATA.orders
          .filter(o => o.user_id === userId)
          .reduce((sum, order) => sum + order.total, 0);

        expect(row.user_status).toBe('active');
        expect(Number(row.completed_orders)).toBe(completedOrders.length);
        expect(Number(row.total_spent)).toBeCloseTo(totalSpent, 2);
      }
    });

    test('should perform window functions with joins', async () => {
      const query = `
        SELECT 
          o.id as order_id,
          u.user_name,
          o.total,
          o.created_at,
          SUM(o.total) OVER (PARTITION BY o.user_id ORDER BY o.created_at) as running_total
        FROM orders o
        JOIN users u ON o.user_id = u.id
        ORDER BY u.id ASC, o.created_at ASC
      `;

      const client = ClickHouseConnection.getClient();
      const result = await client.query({
        query,
        format: 'JSONEachRow'
      }).then(res => res.json()) as WindowFunctionResult[];

      expect(result).toHaveLength(TEST_DATA.orders.length);

      // Group orders by user to verify running totals
      const ordersByUser = TEST_DATA.orders.reduce((acc, order) => {
        if (!acc[order.user_id]) {
          acc[order.user_id] = [];
        }
        acc[order.user_id].push(order);
        return acc;
      }, {} as Record<number, typeof TEST_DATA.orders>);

      // Sort orders by created_at for each user
      Object.values(ordersByUser).forEach(userOrders => {
        userOrders.sort((a, b) =>
          new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
        );
      });

      // Verify running totals
      for (const row of result) {
        const order = TEST_DATA.orders.find(o => o.id === row.order_id);
        if (!order) continue;

        const userId = order.user_id;
        const orderDate = new Date(order.created_at).getTime();

        // Calculate running total manually
        let runningTotal = 0;
        for (const userOrder of ordersByUser[userId]) {
          if (new Date(userOrder.created_at).getTime() <= orderDate) {
            runningTotal += userOrder.total;
          }
        }

        expect(Number(row.running_total)).toBeCloseTo(runningTotal, 2);
      }
    });
  });
}); 