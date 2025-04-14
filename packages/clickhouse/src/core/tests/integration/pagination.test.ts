import {
  initializeTestConnection,
  setupTestDatabase,
  startClickHouseContainer,
  stopClickHouseContainer,
  TestSchema,
  TEST_DATA
} from './setup';
import { ClickHouseConnection } from '../../../core/connection';

// Skip integration tests if running in CI or if explicitly disabled
const SKIP_INTEGRATION_TESTS = process.env.SKIP_INTEGRATION_TESTS === 'true' || process.env.CI === 'true';

describe('Integration Tests - Pagination', () => {
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

    afterAll(async () => {
      if (!SKIP_INTEGRATION_TESTS) {
        try {
          // Wait for any pending operations to complete
          console.log('Starting test cleanup...');
          await new Promise(resolve => setTimeout(resolve, 1000));

          // Close any active client connections to prevent lingering queries
          if (db) {
            try {
              const client = ClickHouseConnection.getClient();
              console.log('Closing ClickHouse client connection...');

              // Wait for any in-flight queries to complete
              await new Promise(resolve => setTimeout(resolve, 500));

              // Ensure we're not running any more queries
              await client.close().catch(err => {
                console.error('Error closing ClickHouse client:', err);
              });

              console.log('ClickHouse client closed successfully');
            } catch (closeError) {
              console.error('Error during client close:', closeError);
            }
          }

          // Then stop the container
          console.log('Stopping ClickHouse container...');
          await stopClickHouseContainer();
          console.log('Cleanup completed');

          // Make sure all async operations have a chance to complete
          await new Promise(resolve => setTimeout(resolve, 500));
        } catch (error) {
          console.error('Error during test cleanup:', error);
        }
      }
    }, 15000); // Allow up to 15 seconds for teardown

    test('should paginate results with cursor-based pagination', async () => {
      // Get first page
      const firstPage = await db.table('test_table')
        .orderBy('id', 'ASC')
        .paginate({
          pageSize: 2,
          orderBy: [{ column: 'id', direction: 'ASC' }]
        });

      expect(firstPage.data).toHaveLength(2);
      expect(firstPage.pageInfo.hasNextPage).toBe(true);
      expect(firstPage.pageInfo.hasPreviousPage).toBe(false);
      expect(firstPage.pageInfo.startCursor).toBeTruthy();
      expect(firstPage.pageInfo.endCursor).toBeTruthy();
      expect(firstPage.data[0].id).toBe(1);
      expect(firstPage.data[1].id).toBe(2);

      // Get second page using the cursor
      const secondPage = await db.table('test_table')
        .orderBy('id', 'ASC')
        .paginate({
          pageSize: 2,
          after: firstPage.pageInfo.endCursor,
          orderBy: [{ column: 'id', direction: 'ASC' }]
        });

      expect(secondPage.data).toHaveLength(2);
      expect(secondPage.pageInfo.hasNextPage).toBe(true);
      expect(secondPage.pageInfo.hasPreviousPage).toBe(true);
      expect(secondPage.data[0].id).toBe(3);
      expect(secondPage.data[1].id).toBe(4);

      // Get third page using the cursor
      const thirdPage = await db.table('test_table')
        .orderBy('id', 'ASC')
        .paginate({
          pageSize: 2,
          after: secondPage.pageInfo.endCursor,
          orderBy: [{ column: 'id', direction: 'ASC' }]
        });

      expect(thirdPage.data).toHaveLength(1); // Only one record left
      expect(thirdPage.pageInfo.hasNextPage).toBe(false);
      expect(thirdPage.pageInfo.hasPreviousPage).toBe(true);
      expect(thirdPage.data[0].id).toBe(5);
    });

    test('should navigate backwards with cursor-based pagination', async () => {
      // Get first page
      const firstPage = await db.table('test_table')
        .orderBy('id', 'ASC')
        .paginate({
          pageSize: 2,
          orderBy: [{ column: 'id', direction: 'ASC' }]
        });

      // Get second page
      const secondPage = await db.table('test_table')
        .orderBy('id', 'ASC')
        .paginate({
          pageSize: 2,
          after: firstPage.pageInfo.endCursor,
          orderBy: [{ column: 'id', direction: 'ASC' }]
        });

      // Navigate back to first page
      const backToFirstPage = await db.table('test_table')
        .orderBy('id', 'ASC')
        .paginate({
          pageSize: 2,
          before: secondPage.pageInfo.startCursor,
          orderBy: [{ column: 'id', direction: 'ASC' }]
        });

      expect(backToFirstPage.data).toHaveLength(2);
      expect(backToFirstPage.pageInfo.hasNextPage).toBe(true);
      expect(backToFirstPage.pageInfo.hasPreviousPage).toBe(false);
      expect(backToFirstPage.data[0].id).toBe(1);
      expect(backToFirstPage.data[1].id).toBe(2);
    });

    test('should handle empty results', async () => {
      const result = await db.table('test_table')
        .where('id', 'gt', 100) // No records with id > 100
        .paginate({
          pageSize: 10,
          orderBy: [{ column: 'id', direction: 'ASC' }]
        });

      expect(result.data).toHaveLength(0);
      expect(result.pageInfo.hasNextPage).toBe(false);
      expect(result.pageInfo.hasPreviousPage).toBe(false);
      expect(result.pageInfo.startCursor).toBe('');
      expect(result.pageInfo.endCursor).toBe('');
    });

    test('should handle exactly pageSize results', async () => {
      const result = await db.table('test_table')
        .where('id', 'lte', 2) // Only 2 records
        .paginate({
          pageSize: 2,
          orderBy: [{ column: 'id', direction: 'ASC' }]
        });

      console.log('CHECK!!!!: ', result.pageInfo)
      expect(result.data).toHaveLength(2);
      expect(result.pageInfo.hasNextPage).toBe(false);
      expect(result.pageInfo.hasPreviousPage).toBe(false);
    });

    test('should iterate through all pages', async () => {
      const allResults: any[] = [];

      for await (const page of db.table('test_table')
        .orderBy('id', 'ASC')
        .iteratePages(2)) {
        allResults.push(...page.data);
      }

      expect(allResults).toHaveLength(TEST_DATA.test_table.length);

      // Check that all records were retrieved in the correct order
      for (let i = 0; i < allResults.length; i++) {
        expect(allResults[i].id).toBe(i + 1);
      }
    });

    test('should paginate with complex ordering', async () => {
      // First page ordered by price descending
      const firstPage = await db.table('test_table')
        .paginate({
          pageSize: 2,
          orderBy: [{ column: 'price', direction: 'DESC' }]
        });

      expect(firstPage.data).toHaveLength(2);

      // Verify ordering
      expect(Number(firstPage.data[0].price)).toBeGreaterThanOrEqual(Number(firstPage.data[1].price));

      // Get second page
      const secondPage = await db.table('test_table')
        .paginate({
          pageSize: 2,
          after: firstPage.pageInfo.endCursor,
          orderBy: [{ column: 'price', direction: 'DESC' }]
        });

      expect(secondPage.data).toHaveLength(2);

      // Verify ordering continues correctly
      expect(Number(firstPage.data[1].price)).toBeGreaterThanOrEqual(Number(secondPage.data[0].price));
      expect(Number(secondPage.data[0].price)).toBeGreaterThanOrEqual(Number(secondPage.data[1].price));
    });
  });
}); 