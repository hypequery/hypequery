import {
  initializeTestConnection,
  setupTestDatabase,
  startClickHouseContainer,
  stopClickHouseContainer,
  TestSchema,
  TEST_DATA
} from './setup';
import { CrossFilter } from '../../../index';

// Skip integration tests if running in CI or if explicitly disabled
const SKIP_INTEGRATION_TESTS = process.env.SKIP_INTEGRATION_TESTS === 'true' || process.env.CI === 'true';

describe('Integration Tests - Cross Filtering', () => {
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

    test('should apply simple cross filter', async () => {
      // Create a cross filter for category = 'A'
      const filter = new CrossFilter();
      filter.add({
        column: 'category',
        operator: 'eq',
        value: 'A'
      });

      // Apply the filter to a query
      const result = await db.table('test_table')
        .applyCrossFilters(filter)
        .execute();

      // Verify results
      const expectedCount = TEST_DATA.test_table.filter(item => item.category === 'A').length;
      expect(result).toHaveLength(expectedCount);
      expect(result.every(item => String(item.category) === 'A')).toBe(true);
    });

    test('should apply multiple conditions with AND', async () => {
      // Create a cross filter for category = 'A' AND active = 1
      const filter = new CrossFilter();
      filter.add({
        column: 'category',
        operator: 'eq',
        value: 'A'
      });
      filter.add({
        column: 'active',
        operator: 'eq',
        value: 1
      });

      // Apply the filter to a query
      const result = await db.table('test_table')
        .applyCrossFilters(filter)
        .execute();

      // Verify results
      const expectedCount = TEST_DATA.test_table.filter(
        item => item.category === 'A' && item.active === 1
      ).length;
      expect(result).toHaveLength(expectedCount);
      expect(result.every(item => String(item.category) === 'A' && Number(item.active) === 1)).toBe(true);
    });

    test('should apply range filters', async () => {
      // Create a cross filter for price between 15 and 25
      const filter = new CrossFilter();
      filter.add({
        column: 'price',
        operator: 'gte',
        value: 15
      });
      filter.add({
        column: 'price',
        operator: 'lte',
        value: 25
      });

      // Apply the filter to a query
      const result = await db.table('test_table')
        .applyCrossFilters(filter)
        .execute();

      // Verify results
      const expectedCount = TEST_DATA.test_table.filter(
        item => item.price >= 15 && item.price <= 25
      ).length;
      expect(result).toHaveLength(expectedCount);
      expect(result.every(item =>
        Number(item.price) >= 15 && Number(item.price) <= 25
      )).toBe(true);
    });

    test('should apply filter groups with OR', async () => {
      // Create a cross filter for (category = 'A' OR category = 'B')
      const filter = new CrossFilter();
      filter.addGroup([
        {
          column: 'category',
          operator: 'eq',
          value: 'A'
        },
        {
          column: 'category',
          operator: 'eq',
          value: 'B'
        }
      ], 'OR');

      // Apply the filter to a query
      const result = await db.table('test_table')
        .applyCrossFilters(filter)
        .execute();

      // Verify results
      const expectedCount = TEST_DATA.test_table.filter(
        item => item.category === 'A' || item.category === 'B'
      ).length;
      expect(result).toHaveLength(expectedCount);
      expect(result.every(item =>
        String(item.category) === 'A' || String(item.category) === 'B'
      )).toBe(true);
    });

    test('should apply complex nested filters', async () => {
      // Create a cross filter for:
      // (category = 'A' OR category = 'B') AND (price > 15 OR active = 0)
      const filter = new CrossFilter();

      // First group: category = 'A' OR category = 'B'
      filter.addGroup([
        {
          column: 'category',
          operator: 'eq',
          value: 'A'
        },
        {
          column: 'category',
          operator: 'eq',
          value: 'B'
        }
      ], 'OR');

      // Second group: price > 15 OR active = 0
      filter.addGroup([
        {
          column: 'price',
          operator: 'gt',
          value: 15
        },
        {
          column: 'active',
          operator: 'eq',
          value: 0
        }
      ], 'OR');

      // Apply the filter to a query
      const result = await db.table('test_table')
        .applyCrossFilters(filter)
        .execute();

      // Verify results
      const expectedCount = TEST_DATA.test_table.filter(
        item => (item.category === 'A' || item.category === 'B') &&
          (item.price > 15 || item.active === 0)
      ).length;
      expect(result).toHaveLength(expectedCount);

      // Verify each result matches our complex condition
      expect(result.every(item =>
        (String(item.category) === 'A' || String(item.category) === 'B') &&
        (Number(item.price) > 15 || Number(item.active) === 0)
      )).toBe(true);
    });

    test('should apply cross filter to multiple queries', async () => {
      // Create a cross filter for active = 1
      const filter = new CrossFilter();
      filter.add({
        column: 'active',
        operator: 'eq',
        value: 1
      });

      // Apply to first query - get all active records
      const allActiveResult = await db.table('test_table')
        .applyCrossFilters(filter)
        .execute();

      // Apply to second query - count active records by category
      const countByCategory = await db.table('test_table')
        .applyCrossFilters(filter)
        .select(['category'])
        .count('id', 'count')
        .groupBy('category')
        .execute();

      // Verify first query results
      const expectedActiveCount = TEST_DATA.test_table.filter(
        item => item.active === 1
      ).length;
      expect(allActiveResult).toHaveLength(expectedActiveCount);
      expect(allActiveResult.every(item => Number(item.active) === 1)).toBe(true);

      // Verify second query results
      const categories = [...new Set(TEST_DATA.test_table
        .filter(item => item.active === 1)
        .map(item => item.category))];

      expect(countByCategory).toHaveLength(categories.length);

      // Check counts for each category
      for (const category of categories) {
        const expectedCount = TEST_DATA.test_table.filter(
          item => item.category === category && item.active === 1
        ).length;

        const categoryResult = countByCategory.find(item => String(item.category) === category);
        expect(Number(categoryResult?.count)).toBe(expectedCount);
      }
    });
  });
}); 