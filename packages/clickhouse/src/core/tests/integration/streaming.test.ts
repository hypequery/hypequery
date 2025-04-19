import { createQueryBuilder } from '../../../index';
import { initializeTestConnection, setupTestDatabase } from './setup';

// Import centralized test configuration
import { SKIP_INTEGRATION_TESTS, SETUP_TIMEOUT } from './test-config';

// Define a type for the response chunks we're getting
interface ResponseChunk {
  json?: () => Promise<any>;
  text?: string;
  [key: string]: any; // For other properties
}

/**
 * Helper function to process response chunks into usable data
 */
async function processStreamChunks(chunks: ResponseChunk[]): Promise<any[]> {
  const results: any[] = [];

  for (const chunk of chunks) {
    if (typeof chunk.json === 'function') {
      const row = await chunk.json();
      results.push(row);
    } else if (chunk.text) {
      const row = JSON.parse(chunk.text);
      results.push(row);
    } else {
      results.push(chunk);
    }
  }

  return results;
}

// Only run these tests if not skipped
(SKIP_INTEGRATION_TESTS ? describe.skip : describe)('Streaming Support', () => {
  let db: ReturnType<typeof createQueryBuilder<any>>;

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
  }, SETUP_TIMEOUT);

  it('should stream results from a simple query', async () => {
    const stream = await db
      .table('test_table')
      .select(['id', 'name', 'price'])
      .where('is_active', 'eq', 1)
      .stream();

    const results: any[] = [];
    const reader = stream.getReader();

    try {
      let done = false;
      while (!done) {
        const result = await reader.read();
        done = result.done;
        if (!done && result.value) {
          // Process chunks using our helper
          const rows = await processStreamChunks(result.value as ResponseChunk[]);
          results.push(...rows);
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
    const stream = await db
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
          // Process chunks using our helper
          const rows = await processStreamChunks(result.value as ResponseChunk[]);
          results.push(...rows);
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
    const stream = await db
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
          // Process chunks using our helper
          const rows = await processStreamChunks(result.value as ResponseChunk[]);
          results.push(...rows);
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

  it('should stream results with complex filtering', async () => {
    const stream = await db
      .table('test_table')
      .select(['id', 'name', 'price', 'category', 'is_active'])
      .where('is_active', 'eq', 1)
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
          // Process chunks using our helper
          const rows = await processStreamChunks(result.value as ResponseChunk[]);
          results.push(...rows);
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
      expect(row.is_active).toBe(true);
      expect(row.price).toBeGreaterThan(20);
      expect(['A', 'B']).toContain(row.category);
    });
  });

  it('should handle streaming with multiple joins', async () => {
    const stream = await db
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
          // Process chunks using our helper
          const rows = await processStreamChunks(result.value as ResponseChunk[]);
          results.push(...rows);
        }
      }
    } finally {
      reader.releaseLock();
    }

    // Add a small delay to ensure all logs are processed
    await new Promise(resolve => setTimeout(resolve, 100));

    // Verify results
    expect(results.length).toBeGreaterThan(0);
    expect(results[0]).toHaveProperty('total');
    expect(results[0]).toHaveProperty('user_name');
    expect(results[0]).toHaveProperty('name');
  });

  it('should process streams with streamForEach', async () => {
    const results: any[] = [];

    await db
      .table('test_table')
      .select(['id', 'name', 'price'])
      .where('is_active', 'eq', 1)
      .streamForEach(async (row: ResponseChunk) => {
        // Use the same logic as in our helper function
        if (typeof row.json === 'function') {
          const data = await row.json();
          results.push(data);
        } else if (row.text) {
          const data = JSON.parse(row.text);
          results.push(data);
        } else {
          results.push(row);
        }
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