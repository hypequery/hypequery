import {
  initializeTestConnection,
  setupTestDatabase,
  TestSchema,
  TEST_DATA
} from './setup';
import { ClickHouseConnection } from '../../connection';

// Skip integration tests if running in CI or if explicitly disabled
const SKIP_INTEGRATION_TESTS = process.env.SKIP_INTEGRATION_TESTS === 'true' || process.env.CI === 'true';

// Define types for our query results
interface CategorySalesResult {
  category: string;
  total_sales: number;
  order_count: number;
  avg_order_value: number;
}

interface UserPurchaseResult {
  user_id: number;
  user_name: string;
  total_spent: number;
  order_count: number;
}

interface ProductPopularityResult {
  product_id: number;
  product_name: string;
  total_quantity: number;
  total_revenue: number;
}

interface OrderStatusResult {
  status: string;
  order_count: number;
  percentage: number;
}

interface DailyOrdersResult {
  order_date: string;
  order_count: number;
  total_sales: number;
}

interface RetentionResult {
  user_id: number;
  first_order_date: string;
  repeat_orders: number;
}

describe('Integration Tests - Analytical Queries', () => {
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

    test('should analyze sales by product category', async () => {
      const query = `
        SELECT 
          p.category,
          SUM(o.total) as total_sales,
          COUNT(o.id) as order_count,
          AVG(o.total) as avg_order_value
        FROM orders o
        JOIN test_table p ON o.product_id = p.id
        GROUP BY p.category
        ORDER BY total_sales DESC
      `;

      const client = ClickHouseConnection.getClient();
      const result = await client.query({
        query,
        format: 'JSONEachRow'
      }).then(res => res.json()) as CategorySalesResult[];

      // Verify we have results for each category
      const categories = [...new Set(TEST_DATA.test_table.map(p => p.category))];
      expect(result).toHaveLength(categories.length);

      // Verify the calculations for each category
      for (const row of result) {
        // Calculate expected values manually
        const categoryProducts = TEST_DATA.test_table.filter(p => p.category === row.category);
        const categoryProductIds = categoryProducts.map(p => p.id);
        const categoryOrders = TEST_DATA.orders.filter(o => categoryProductIds.includes(o.product_id));

        const expectedTotalSales = categoryOrders.reduce((sum, order) => sum + order.total, 0);
        const expectedOrderCount = categoryOrders.length;
        const expectedAvgOrderValue = expectedTotalSales / expectedOrderCount;

        expect(Number(row.total_sales)).toBeCloseTo(expectedTotalSales, 2);
        expect(Number(row.order_count)).toBe(expectedOrderCount);
        expect(Number(row.avg_order_value)).toBeCloseTo(expectedAvgOrderValue, 2);
      }
    });

    test('should analyze user purchase behavior', async () => {
      const query = `
        SELECT 
          u.id as user_id,
          u.user_name,
          SUM(o.total) as total_spent,
          COUNT(o.id) as order_count
        FROM users u
        JOIN orders o ON u.id = o.user_id
        GROUP BY u.id, u.user_name
        ORDER BY total_spent DESC
      `;

      const client = ClickHouseConnection.getClient();
      const result = await client.query({
        query,
        format: 'JSONEachRow'
      }).then(res => res.json()) as UserPurchaseResult[];

      // Verify we have results for users with orders
      const usersWithOrders = [...new Set(TEST_DATA.orders.map(o => o.user_id))];
      expect(result).toHaveLength(usersWithOrders.length);

      // Verify the calculations for each user
      for (const row of result) {
        const userOrders = TEST_DATA.orders.filter(o => o.user_id === row.user_id);
        const expectedTotalSpent = userOrders.reduce((sum, order) => sum + order.total, 0);
        const expectedOrderCount = userOrders.length;

        expect(Number(row.total_spent)).toBeCloseTo(expectedTotalSpent, 2);
        expect(Number(row.order_count)).toBe(expectedOrderCount);
      }

      // Verify the ordering (highest total_spent first)
      for (let i = 1; i < result.length; i++) {
        expect(Number(result[i - 1].total_spent)).toBeGreaterThanOrEqual(Number(result[i].total_spent));
      }
    });

    test('should analyze product popularity', async () => {
      const query = `
        SELECT 
          p.id as product_id,
          p.name as product_name,
          SUM(o.quantity) as total_quantity,
          SUM(o.total) as total_revenue
        FROM test_table p
        JOIN orders o ON p.id = o.product_id
        GROUP BY p.id, p.name
        ORDER BY total_quantity DESC
      `;

      const client = ClickHouseConnection.getClient();
      const result = await client.query({
        query,
        format: 'JSONEachRow'
      }).then(res => res.json()) as ProductPopularityResult[];

      // Verify we have results for products with orders
      const productsWithOrders = [...new Set(TEST_DATA.orders.map(o => o.product_id))];
      expect(result).toHaveLength(productsWithOrders.length);

      // Verify the calculations for each product
      for (const row of result) {
        const productOrders = TEST_DATA.orders.filter(o => o.product_id === row.product_id);
        const expectedTotalQuantity = productOrders.reduce((sum, order) => sum + order.quantity, 0);
        const expectedTotalRevenue = productOrders.reduce((sum, order) => sum + order.total, 0);

        expect(Number(row.total_quantity)).toBe(expectedTotalQuantity);
        expect(Number(row.total_revenue)).toBeCloseTo(expectedTotalRevenue, 2);
      }

      // Verify the ordering (highest total_quantity first)
      for (let i = 1; i < result.length; i++) {
        expect(Number(result[i - 1].total_quantity)).toBeGreaterThanOrEqual(Number(result[i].total_quantity));
      }
    });

    test('should analyze order status distribution', async () => {
      const query = `
        SELECT 
          status,
          COUNT(*) as order_count,
          COUNT(*) / (SELECT COUNT(*) FROM orders) * 100 as percentage
        FROM orders
        GROUP BY status
        ORDER BY order_count DESC
      `;

      const client = ClickHouseConnection.getClient();
      const result = await client.query({
        query,
        format: 'JSONEachRow'
      }).then(res => res.json()) as OrderStatusResult[];

      // Verify we have results for each status
      const statuses = [...new Set(TEST_DATA.orders.map(o => o.status))];
      expect(result).toHaveLength(statuses.length);

      // Verify the calculations for each status
      const totalOrders = TEST_DATA.orders.length;

      for (const row of result) {
        const statusOrders = TEST_DATA.orders.filter(o => o.status === row.status);
        const expectedOrderCount = statusOrders.length;
        const expectedPercentage = (expectedOrderCount / totalOrders) * 100;

        expect(Number(row.order_count)).toBe(expectedOrderCount);
        expect(Number(row.percentage)).toBeCloseTo(expectedPercentage, 2);
      }

      // Verify the ordering (highest order_count first)
      for (let i = 1; i < result.length; i++) {
        expect(Number(result[i - 1].order_count)).toBeGreaterThanOrEqual(Number(result[i].order_count));
      }
    });

    test('should analyze daily order trends', async () => {
      const query = `
        SELECT 
          toDate(created_at) as order_date,
          COUNT(*) as order_count,
          SUM(total) as total_sales
        FROM orders
        GROUP BY order_date
        ORDER BY order_date ASC
      `;

      const client = ClickHouseConnection.getClient();
      const result = await client.query({
        query,
        format: 'JSONEachRow'
      }).then(res => res.json()) as DailyOrdersResult[];

      // Group orders by date for verification
      const ordersByDate = TEST_DATA.orders.reduce((acc, order) => {
        const date = order.created_at.split(' ')[0]; // Extract date part
        if (!acc[date]) {
          acc[date] = [];
        }
        acc[date].push(order);
        return acc;
      }, {} as Record<string, typeof TEST_DATA.orders>);

      const uniqueDates = Object.keys(ordersByDate).sort();
      expect(result).toHaveLength(uniqueDates.length);

      // Verify the calculations for each date
      for (let i = 0; i < result.length; i++) {
        const row = result[i];
        const rowDate = row.order_date.split('T')[0]; // Format might be different
        const dateOrders = ordersByDate[uniqueDates[i]];

        const expectedOrderCount = dateOrders.length;
        const expectedTotalSales = dateOrders.reduce((sum, order) => sum + order.total, 0);

        expect(Number(row.order_count)).toBe(expectedOrderCount);
        expect(Number(row.total_sales)).toBeCloseTo(expectedTotalSales, 2);
      }
    });

    test('should analyze user retention', async () => {
      const query = `
        WITH first_orders AS (
          SELECT 
            user_id,
            MIN(toDate(created_at)) as first_order_date
          FROM orders
          GROUP BY user_id
        ),
        repeat_orders AS (
          SELECT 
            o.user_id,
            COUNT(*) as repeat_order_count
          FROM orders o
          JOIN first_orders fo ON o.user_id = fo.user_id
          WHERE toDate(o.created_at) > fo.first_order_date
          GROUP BY o.user_id
        )
        SELECT 
          u.id as user_id,
          u.user_name,
          fo.first_order_date,
          COALESCE(ro.repeat_order_count, 0) as repeat_orders
        FROM users u
        JOIN first_orders fo ON u.id = fo.user_id
        LEFT JOIN repeat_orders ro ON u.id = ro.user_id
        ORDER BY repeat_orders DESC, first_order_date ASC
      `;

      const client = ClickHouseConnection.getClient();
      const result = await client.query({
        query,
        format: 'JSONEachRow'
      }).then(res => res.json()) as RetentionResult[];

      // Verify we have results for users with orders
      const usersWithOrders = [...new Set(TEST_DATA.orders.map(o => o.user_id))];
      expect(result).toHaveLength(usersWithOrders.length);

      // Verify the calculations for each user
      for (const row of result) {
        const userId = Number(row.user_id);
        const userOrders = TEST_DATA.orders.filter(o => o.user_id === userId)
          .sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());

        // Calculate first order date
        const firstOrderDate = userOrders[0].created_at.split(' ')[0];

        // Calculate repeat orders (orders after the first one)
        const repeatOrders = userOrders.filter(o =>
          o.created_at.split(' ')[0] > firstOrderDate
        ).length;

        expect(row.first_order_date.split('T')[0]).toBe(firstOrderDate);
        expect(Number(row.repeat_orders)).toBe(repeatOrders);
      }
    });
  });
}); 