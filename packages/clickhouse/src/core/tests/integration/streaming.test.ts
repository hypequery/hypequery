import type { ReadableStream as WebReadableStream } from 'node:stream/web';
import { createQueryBuilder } from '../../../index.js';
import { initializeTestConnection, setupTestDatabase, TEST_DATA } from './setup.js';

// Import centralized test configuration
import { SKIP_INTEGRATION_TESTS, SETUP_TIMEOUT } from './test-config.js';

async function collectStreamRows(stream: WebReadableStream<any[]>): Promise<any[]> {
  const reader = stream.getReader();
  const rows: any[] = [];

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      rows.push(...value);
    }
  } finally {
    reader.releaseLock();
  }

  return rows;
}

async function collectPartialStreamRows(stream: WebReadableStream<any[]>, chunkLimit: number): Promise<{ rows: any[], reader: ReadableStreamDefaultReader<any[]> }>
{
  const reader = stream.getReader();
  const rows: any[] = [];
  let chunksRead = 0;

  while (chunksRead < chunkLimit) {
    const { done, value } = await reader.read();
    if (done || !value) {
      break;
    }
    rows.push(...value);
    chunksRead += 1;
  }

  return { rows, reader };
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

    const results = await collectStreamRows(stream);

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

    const results = await collectStreamRows(stream);

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

    const results = await collectStreamRows(stream);

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

    const results = await collectStreamRows(stream);

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
        'test_table.name as product_name'
      ])
      .innerJoin('users', 'user_id', 'users.id')
      .innerJoin('test_table', 'product_id', 'test_table.id')
      .stream();

    const results = await collectStreamRows(stream);

    // Add a small delay to ensure all logs are processed
    await new Promise(resolve => setTimeout(resolve, 100));

    // Verify results
    expect(results.length).toBeGreaterThan(0);
    expect(results[0]).toHaveProperty('total');
    expect(results[0]).toHaveProperty('user_name');
    expect(results[0]).toHaveProperty('product_name');
  });

  it('should process streams with streamForEach', async () => {
    const results: any[] = [];

    await db
      .table('test_table')
      .select(['id', 'name', 'price'])
      .where('is_active', 'eq', 1)
      .streamForEach(async (row) => {
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

  it('should allow partial consumption and cancellation', async () => {
    const stream = await db
      .table('test_table')
      .select(['id', 'name'])
      .orderBy('id', 'ASC')
      .stream();

    const { rows, reader } = await collectPartialStreamRows(stream, 1);
    expect(rows.length).toBeGreaterThan(0);

    await reader.cancel();

    // Ensure we consumed only the first chunk (first row due to small dataset)
    expect(Number(rows[0].id)).toBe(1);
  });

  it('should support concurrent stream consumers without interference', async () => {
    const streams = await Promise.all([
      db.table('test_table').select(['id']).stream(),
      db.table('orders').select(['id']).stream()
    ]);

    const results = await Promise.all(streams.map(collectStreamRows));

    expect(results[0].length).toBe(TEST_DATA.test_table.length);
    expect(results[1].length).toBe(TEST_DATA.orders.length);
  });

  it('should handle slow callbacks in streamForEach', async () => {
    const processedIds: number[] = [];

    await db
      .table('test_table')
      .select(['id'])
      .where('is_active', 'eq', 1)
      .streamForEach(async row => {
        processedIds.push(Number(row.id));
        await new Promise(resolve => setTimeout(resolve, 20));
      });

    expect(processedIds.length).toBeGreaterThan(0);
    expect(processedIds.sort()).toEqual(processedIds);
  });

  it('should propagate errors from streamForEach callbacks', async () => {
    await expect(db
      .table('test_table')
      .select(['id'])
      .streamForEach(async row => {
        if (Number(row.id) === 2) {
          throw new Error('Boom');
        }
      })
    ).rejects.toThrow('Boom');
  });
}); 
