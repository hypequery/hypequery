// @ts-nocheck
import {
  initializeTestConnection,
  setupTestDatabase,
  TEST_DATA
} from './setup';
import { ClickHouseConnection } from '../../connection.js';
import { createQueryBuilder } from '../../../index.js';
import { raw, rawAs } from '../../utils/sql-expressions.js';

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
  user_name: string;
  first_order_date: string;
  repeat_orders: number;
}

interface CohortAnalysisResult {
  cohort_month: string;
  cohort_size: number;
  month_number: number;
  active_users: number;
  retention_rate: number;
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
      const result = await db
        .table('orders')
        .select(['test_table.category'])
        .sum('orders.total', 'total_sales')
        .count('orders.id', 'order_count')
        .avg('orders.total', 'avg_order_value')
        .innerJoin('test_table', 'product_id', 'test_table.id')
        .groupBy('test_table.category')
        .orderBy('total_sales', 'DESC')
        .execute();

      // Verify we have results for each category that has orders
      const categoriesWithOrders = [
        ...new Set(
          TEST_DATA.orders
            .map(order => TEST_DATA.test_table.find(product => product.id === order.product_id)?.category)
            .filter((category): category is string => Boolean(category))
        )
      ];
      expect(result).toHaveLength(categoriesWithOrders.length);

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
      const result = await db
        .table('users')
        .select([
          'users.id as user_id',
          'users.user_name'
        ])
        .innerJoin('orders', 'users.id', 'orders.user_id')
        .sum('orders.total', 'total_spent')
        .count('orders.id', 'order_count')
        .groupBy(['users.id', 'users.user_name'])
        .orderBy('total_spent', 'DESC')
        .execute();

      // Verify we have results for users with orders
      const usersWithOrders = [...new Set(TEST_DATA.orders.map(o => o.user_id))];
      expect(result).toHaveLength(usersWithOrders.length);

      // Verify the calculations for each user
      for (const row of result) {
        const userOrders = TEST_DATA.orders.filter(o => o.user_id === Number(row.user_id));
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
      const result = await db
        .table('test_table')
        .select([
          'test_table.id as product_id',
          'test_table.name as product_name'
        ])
        .innerJoin('orders', 'test_table.id', 'orders.product_id')
        .sum('orders.quantity', 'total_quantity')
        .sum('orders.total', 'total_revenue')
        .groupBy(['test_table.id', 'test_table.name'])
        .orderBy('total_quantity', 'DESC')
        .execute();

      // Verify we have results for products with orders
      const productsWithOrders = [...new Set(TEST_DATA.orders.map(o => o.product_id))];
      expect(result).toHaveLength(productsWithOrders.length);

      // Verify the calculations for each product
      for (const row of result) {
        const productOrders = TEST_DATA.orders.filter(o => o.product_id === Number(row.product_id));
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
      // Get total order count
      const totalOrdersResult = await db
        .table('orders')
        .count('id', 'total_count')
        .execute();

      const totalOrderCount = Number(totalOrdersResult[0].total_count);

      // Get count by status
      const result = await db
        .table('orders')
        .select(['status'])
        .count('id', 'order_count')
        .groupBy('status')
        .orderBy('order_count', 'DESC')
        .execute();

      // Add percentage calculation
      const resultsWithPercentage = result.map(row => ({
        ...row,
        percentage: (Number(row.order_count) / totalOrderCount) * 100
      }));

      // Verify we have results for each status
      const statuses = [...new Set(TEST_DATA.orders.map(o => o.status))];
      expect(resultsWithPercentage).toHaveLength(statuses.length);

      // Verify the calculations for each status
      const totalOrders = TEST_DATA.orders.length;

      for (const row of resultsWithPercentage) {
        const statusOrders = TEST_DATA.orders.filter(o => o.status === row.status);
        const expectedOrderCount = statusOrders.length;
        const expectedPercentage = (expectedOrderCount / totalOrders) * 100;

        expect(Number(row.order_count)).toBe(expectedOrderCount);
        expect(row.percentage).toBeCloseTo(expectedPercentage, 2);
      }

      // Verify the ordering (highest order_count first)
      for (let i = 1; i < resultsWithPercentage.length; i++) {
        expect(Number(resultsWithPercentage[i - 1].order_count)).toBeGreaterThanOrEqual(Number(resultsWithPercentage[i].order_count));
      }
    });

    test('should analyze daily order trends', async () => {
      const result = await db
        .table('orders')
        .select([raw('toDate(created_at) as order_date')])
        .count('id', 'order_count')
        .sum('total', 'total_sales')
        .groupBy('order_date')
        .orderBy('order_date', 'ASC')
        .execute();

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
      // First get all users' first order dates
      const firstOrdersResult = await db
        .table('orders')
        .select(['user_id'])
        .select([raw('MIN(toDate(created_at)) as first_order_date')])
        .groupBy('user_id')
        .execute();

      // Get user details
      const usersResult = await db
        .table('users')
        .select(['id', 'user_name'])
        .execute();

      // Create a map from user_id to first_order_date
      const firstOrderMap = {};
      for (const row of firstOrdersResult) {
        firstOrderMap[row.user_id] = row.first_order_date;
      }

      // Count repeat orders for each user
      const results = [];
      for (const user of usersResult) {
        const userId = user.id;
        const firstOrderDate = firstOrderMap[userId];

        if (!firstOrderDate) continue; // Skip users with no orders

        // Count repeats (orders after first date)
        const repeatOrdersResult = await db
          .table('orders')
          .count('id', 'repeat_order_count')
          .where('user_id', 'eq', userId)
          .where(raw('toDate(created_at)'), 'gt', firstOrderDate)
          .execute();

        const repeatOrders = Number(repeatOrdersResult[0]?.repeat_order_count || 0);

        results.push({
          user_id: userId,
          user_name: user.user_name,
          first_order_date: firstOrderDate,
          repeat_orders: repeatOrders
        });
      }

      // Sort by repeat_orders DESC, first_order_date ASC
      results.sort((a, b) => {
        if (b.repeat_orders !== a.repeat_orders) {
          return b.repeat_orders - a.repeat_orders;
        }
        return new Date(a.first_order_date).getTime() - new Date(b.first_order_date).getTime();
      });

      // Verify the calculations for each user
      for (const row of results) {
        const userId = Number(row.user_id);
        const userOrders = TEST_DATA.orders.filter(o => o.user_id === userId)
          .sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());

        if (userOrders.length === 0) continue;

        // Calculate first order date
        const firstOrderDate = userOrders[0].created_at.split(' ')[0];

        // Calculate repeat orders (orders after the first one)
        const repeatOrders = userOrders.filter(o =>
          o.created_at.split(' ')[0] > firstOrderDate
        ).length;

        expect(row.first_order_date.split('T')[0]).toBe(firstOrderDate);
        expect(row.repeat_orders).toBe(repeatOrders);
      }
    });

    test('should perform cohort analysis with multiple CTEs', async () => {
      // Create a query builder instance
      const cohortQuery = await db.table('cohort_analysis')
        // First CTE: Get first order date for each user (cohort assignment)
        .withCTE('user_cohorts', `
          SELECT 
            user_id,
            toStartOfMonth(toDate(MIN(created_at))) as cohort_month
          FROM orders
          GROUP BY user_id
        `)
        // Second CTE: Get activity months for each user
        .withCTE('user_activity', `
          SELECT
            user_id,
            toStartOfMonth(toDate(created_at)) as activity_month
          FROM orders
          GROUP BY user_id, toStartOfMonth(toDate(created_at))
        `)
        // Third CTE: Calculate user retention by month
        .withCTE('cohort_analysis', `
          SELECT
            uc.cohort_month,
            ua.activity_month,
            dateDiff('month', uc.cohort_month, ua.activity_month) as month_number,
            COUNT(DISTINCT uc.user_id) as active_users
          FROM user_cohorts uc
          INNER JOIN user_activity ua ON uc.user_id = ua.user_id
          WHERE dateDiff('month', uc.cohort_month, ua.activity_month) >= 0
          GROUP BY uc.cohort_month, ua.activity_month, month_number
          ORDER BY uc.cohort_month, month_number
        `)
        // Fourth CTE: Calculate cohort sizes
        .withCTE('cohort_sizes', `
          SELECT
            cohort_month,
            COUNT(DISTINCT user_id) as cohort_size
          FROM user_cohorts
          GROUP BY cohort_month
        `)
        // Main query: Join cohort analysis with cohort sizes to calculate retention rates
        .select([
          'cohort_analysis.cohort_month',
          'cohort_analysis.month_number',
          'cohort_analysis.active_users',
          'cohort_sizes.cohort_size',
          raw('(active_users / cohort_size) * 100 as retention_rate')
        ])
        .innerJoin('cohort_sizes', 'cohort_analysis.cohort_month', 'cohort_sizes.cohort_month')
        .orderBy('cohort_month')
        .orderBy('month_number')
        .execute();

      // Basic assertions on the results
      if (cohortQuery.length > 0) {
        // 1. We have results
        expect(cohortQuery.length).toBeGreaterThan(0);

        // 2. For month_number 0 (same month), retention rate should be 100%
        const zeroMonthRows = cohortQuery.filter(row => Number(row.month_number) === 0);
        for (const row of zeroMonthRows) {
          expect(Number(row.retention_rate)).toBeCloseTo(100, 2);
          expect(Number(row.active_users)).toBe(Number(row.cohort_size));
        }

        // 3. Retention rates should generally decrease as month_number increases
        const cohortMonths = [...new Set(cohortQuery.map(row => row.cohort_month))];
        for (const month of cohortMonths) {
          const monthRows = cohortQuery
            .filter(row => row.cohort_month === month)
            .sort((a, b) => Number(a.month_number) - Number(b.month_number));

          for (let i = 1; i < monthRows.length; i++) {
            // This might not always be true due to test data
            // but typically retention decreases over time
            expect(Number(monthRows[i].retention_rate)).toBeLessThanOrEqual(Number(monthRows[0].retention_rate));
          }
        }

        // 4. Check retention rate calculation is correct
        for (const row of cohortQuery) {
          const calculatedRate = (Number(row.active_users) / Number(row.cohort_size)) * 100;
          expect(Number(row.retention_rate)).toBeCloseTo(calculatedRate, 2);
        }
      }
    });
  });
}); 
