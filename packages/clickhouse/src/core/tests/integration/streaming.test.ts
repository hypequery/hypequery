import { createQueryBuilder } from '../../../index';
import { setupTestDatabase, TEST_DATA, TestSchema, ensureConnectionInitialized } from './setup';
// Import our initializer to ensure connections are set up correctly
import './test-initializer';

// Skip integration tests if running in CI or if explicitly disabled
const SKIP_INTEGRATION_TESTS = process.env.SKIP_INTEGRATION_TESTS === 'true' || process.env.CI === 'true';

describe('Streaming Support', () => {
  let builder: ReturnType<typeof createQueryBuilder<TestSchema>>;

  beforeAll(async () => {
    // Ensure connection is initialized
    ensureConnectionInitialized();

    // Setup database
    await setupTestDatabase();

    // Create query builder
    builder = createQueryBuilder<TestSchema>({
      host: process.env.CLICKHOUSE_TEST_HOST || 'http://localhost:8123',
      username: process.env.CLICKHOUSE_TEST_USER || 'default',
      password: process.env.CLICKHOUSE_TEST_PASSWORD || 'hypequery_test',
      database: process.env.CLICKHOUSE_TEST_DB || 'test_db'
    });
  }, 30000);

  it('should stream results from a simple query', async () => {
    const stream = await builder
      .table('test_table')
      .select(['id', 'name', 'price'])
      .where('active', 'eq', 1)
      .stream();

    const results: any[] = [];
    const reader = stream.getReader();

    try {
      let done = false;
      while (!done) {
        const result = await reader.read();
        done = result.done;
        if (!done && result.value) {
          results.push(...result.value);
        }
      }
    } finally {
      reader.releaseLock();
    }

    // Add a small delay to ensure all logs are processed
    await new Promise(resolve => setTimeout(resolve, 100));

    // Verify results
    expect(results.length).toBeGreaterThan(0);
    expect(results[0]).toHaveProperty('id');
    expect(results[0]).toHaveProperty('name');
    expect(results[0]).toHaveProperty('price');
  });

  it('should stream results with joins', async () => {
    const stream = await builder
      .table('orders')
      .select(['orders.id', 'orders.total', 'users.user_name'])
      .innerJoin('users', 'user_id', 'users.id')
      .stream();

    const results: any[] = [];
    const reader = stream.getReader();

    try {
      let done = false;
      while (!done) {
        const result = await reader.read();
        done = result.done;
        if (!done && result.value) {
          results.push(...result.value);
        }
      }
    } finally {
      reader.releaseLock();
    }

    // Add a small delay to ensure all logs are processed
    await new Promise(resolve => setTimeout(resolve, 100));

    // Verify results
    expect(results.length).toBeGreaterThan(0);
    expect(results[0]).toHaveProperty('id');
    expect(results[0]).toHaveProperty('total');
    expect(results[0]).toHaveProperty('user_name');
  });

  it('should stream results with aggregations', async () => {
    const stream = await builder
      .table('orders')
      .select(['user_id'])
      .sum('total', 'total_amount')
      .groupBy('user_id')
      .stream();

    const results: any[] = [];
    const reader = stream.getReader();

    try {
      let done = false;
      while (!done) {
        const result = await reader.read();
        done = result.done;
        if (!done && result.value) {
          results.push(...result.value);
        }
      }
    } finally {
      reader.releaseLock();
    }

    // Add a small delay to ensure all logs are processed
    await new Promise(resolve => setTimeout(resolve, 100));

    // Verify results
    expect(results.length).toBeGreaterThan(0);
    expect(results[0]).toHaveProperty('user_id');
    expect(results[0]).toHaveProperty('total_amount');
  });

  it('should handle streaming errors gracefully', async () => {
    // Use a type assertion to bypass the type check for this test
    const stream = await (builder as any)
      .table('nonexistent_table')
      .select(['id'])
      .stream();

    const reader = stream.getReader();
    let error: Error | null = null;

    try {
      let done = false;
      while (!done) {
        try {
          const result = await reader.read();
          done = result.done;
          if (!done && result.value) {
            // Should not reach here
          }
        } catch (e) {
          error = e as Error;
          done = true;
        }
      }
    } finally {
      reader.releaseLock();
    }

    // Add a small delay to ensure all logs are processed
    await new Promise(resolve => setTimeout(resolve, 100));

    expect(error).toBeTruthy();
  });

  it('should stream results with pagination', async () => {
    const stream = await builder
      .table('test_table')
      .select(['id', 'name'])
      .limit(3)
      .offset(0)
      .stream();

    const results: any[] = [];
    const reader = stream.getReader();

    try {
      let done = false;
      while (!done) {
        const result = await reader.read();
        done = result.done;
        if (!done && result.value) {
          results.push(...result.value);
        }
      }
    } finally {
      reader.releaseLock();
    }

    // Add a small delay to ensure all logs are processed
    await new Promise(resolve => setTimeout(resolve, 100));

    // Verify results
    expect(results.length).toBeLessThanOrEqual(3);
  });

  it('should stream results with complex filtering', async () => {
    const stream = await builder
      .table('test_table')
      .select(['id', 'name', 'price', 'category'])
      .where('active', 'eq', 1)
      .where('price', 'gt', 20)
      .where('category', 'in', ['A', 'B'])
      .stream();

    const results: any[] = [];
    const reader = stream.getReader();

    try {
      let done = false;
      while (!done) {
        const result = await reader.read();
        done = result.done;
        if (!done && result.value) {
          results.push(...result.value);
        }
      }
    } finally {
      reader.releaseLock();
    }

    // Add a small delay to ensure all logs are processed
    await new Promise(resolve => setTimeout(resolve, 100));

    // Verify results
    expect(results.length).toBeGreaterThan(0);
    results.forEach(row => {
      expect(row.active).toBe(1);
      expect(row.price).toBeGreaterThan(20);
      expect(['A', 'B']).toContain(row.category);
    });
  });

  it('should handle streaming with multiple joins', async () => {
    const stream = await builder
      .table('orders')
      .select([
        'orders.id',
        'orders.total',
        'users.user_name',
        'products.name'
      ])
      .innerJoin('users', 'user_id', 'users.id')
      .innerJoin('products', 'product_id', 'products.id')
      .stream();

    const results: any[] = [];
    const reader = stream.getReader();

    try {
      let done = false;
      while (!done) {
        const result = await reader.read();
        done = result.done;
        if (!done && result.value) {
          results.push(...result.value);
        }
      }
    } finally {
      reader.releaseLock();
    }

    // Add a small delay to ensure all logs are processed
    await new Promise(resolve => setTimeout(resolve, 100));

    // Verify results
    expect(results.length).toBeGreaterThan(0);
    expect(results[0]).toHaveProperty('id');
    expect(results[0]).toHaveProperty('user_name');
    expect(results[0]).toHaveProperty('name');
  });

  it('should process streams with streamForEach', async () => {
    const results: any[] = [];

    await builder
      .table('test_table')
      .select(['id', 'name', 'price'])
      .where('active', 'eq', 1)
      .streamForEach(row => {
        results.push(row);
      });

    // Add a small delay to ensure all logs are processed
    await new Promise(resolve => setTimeout(resolve, 100));

    // Verify results
    expect(results.length).toBeGreaterThan(0);
    expect(results[0]).toHaveProperty('id');
    expect(results[0]).toHaveProperty('name');
    expect(results[0]).toHaveProperty('price');
  });
}); 