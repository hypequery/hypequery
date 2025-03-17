/**
 * HypeQuery Logging and Streaming Example
 * 
 * This example demonstrates:
 * 1. Configuring the logger for detailed query insights
 * 2. Processing large datasets with streaming
 * 3. Using the streamForEach helper method
 * 4. Subscribing to logs for specific queries
 * 
 * Setup:
 * - Ensure you have a running ClickHouse instance (see README-logging-and-streaming.md)
 * - Create a 'users' table with the schema shown below
 * - Run this example with: npx ts-node examples/logging-and-streaming-example.ts
 * 
 * Schema:
 * CREATE TABLE test_db.users (
 *   id Int32,
 *   name String,
 *   email String,
 *   age Int32,
 *   created_at DateTime
 * ) ENGINE = MergeTree()
 * ORDER BY id
 */

import { createQueryBuilder, logger } from '../packages/core/src/index';

// Define the schema matching our test database
interface TestSchema {
  users: {
    id: 'Int32';
    name: 'String';
    email: 'String';
    age: 'Int32';
    created_at: 'DateTime';
  };
}

// Helper to process rows for demonstration
function processRow(row: any) {
  console.log(`Processing user: ${row.name} (${row.email})`);
  // In a real application, you would do something with the data here
}

// Helper to process batches of rows
function processRows(rows: any[]) {
  console.log(`Processing batch of ${rows.length} rows`);
  rows.forEach(row => {
    // Quick processing of the row data
    const processed = {
      ...row,
      nameLength: row.name.length,
      domain: row.email.split('@')[1]
    };
    // In a real app, you might transform data or save to another store
  });
}

// Example 1: Configure the logger
async function demoLoggerConfiguration() {
  console.log('\n--- Logger Configuration Demo ---\n');

  // Configure the logger with custom settings
  logger.configure({
    level: 'debug',  // Show all log levels
    enabled: true,
    onQueryLog: (log) => {
      console.log(`Custom log handler: Query ${log.status}`, {
        duration: log.duration ? `${log.duration}ms` : undefined,
        rows: log.rowCount
      });
    }
  });

  console.log('Logger configured with debug level and custom handler');
}

// Example 2: Basic query with logging
async function demoBasicQueryWithLogging(builder: ReturnType<typeof createQueryBuilder<TestSchema>>) {
  console.log('\n--- Basic Query with Logging Demo ---\n');

  try {
    console.log('Executing simple query...');

    const users = await builder
      .table('users')
      .select(['id', 'name', 'email', 'age'])
      .execute();

    console.log(`Query returned ${users.length} users`);
    console.log('First few users:');
    users.slice(0, 3).forEach(user => {
      console.log(`- ${user.name} (${user.email}), age: ${user.age}`);
    });
  } catch (error) {
    console.error('Error executing query:', error);
  }
}

// Example 3: Streaming large result sets
async function demoStreaming(builder: ReturnType<typeof createQueryBuilder<TestSchema>>) {
  console.log('\n--- Streaming Demo ---\n');

  try {
    console.log('Starting streaming query...');

    const stream = await builder
      .table('users')
      .select(['id', 'name', 'email', 'age'])
      .stream();

    const reader = stream.getReader();
    let totalRows = 0;
    let batchCount = 0;

    try {
      console.log('Processing stream...');

      while (true) {
        const { done, value: rows } = await reader.read();
        if (done) break;

        batchCount++;
        totalRows += rows.length;

        console.log(`Received batch ${batchCount} with ${rows.length} rows`);
        processRows(rows);
      }

      console.log(`Completed stream processing. Processed ${totalRows} rows in ${batchCount} batches.`);
    } finally {
      reader.releaseLock();
    }
  } catch (error) {
    console.error('Error with streaming:', error);
  }
}

// Example 4: Using streamForEach helper
async function demoStreamForEach(builder: ReturnType<typeof createQueryBuilder<TestSchema>>) {
  console.log('\n--- streamForEach Demo ---\n');

  try {
    console.log('Starting streamForEach...');

    let count = 0;

    await builder
      .table('users')
      .select(['id', 'name', 'email', 'age'])
      .streamForEach(row => {
        count++;
        processRow(row);
      });

    console.log(`Completed streamForEach. Processed ${count} rows.`);
  } catch (error) {
    console.error('Error with streamForEach:', error);
  }
}

// Example 5: Query-specific logging
async function demoQuerySpecificLogging(builder: ReturnType<typeof createQueryBuilder<TestSchema>>) {
  console.log('\n--- Query-Specific Logging Demo ---\n');

  // Create a unique query ID
  const queryId = `demo-query-${Date.now()}`;
  console.log(`Subscribing to logs for query ID: ${queryId}`);

  // Subscribe to logs for this specific query
  const unsubscribe = logger.subscribeToQuery(queryId, (log) => {
    console.log(`Received log for query ${queryId}:`, {
      status: log.status,
      startTime: log.startTime ? new Date(log.startTime).toISOString() : undefined,
      duration: log.duration ? `${log.duration}ms` : undefined,
      rowCount: log.rowCount,
      error: log.error ? log.error.message : undefined
    });
  });

  try {
    // Execute query with the specific queryId
    // Note: In a real application, you would need to pass the queryId to the query
    // For demo purposes, we'll assume the query executor uses our queryId

    await builder
      .table('users')
      .select(['id', 'name'])
      .where('age', 'gt', 25)
      .execute();

    // Wait a bit to ensure all logs are received
    await new Promise(resolve => setTimeout(resolve, 500));
  } catch (error) {
    console.error('Error in query-specific logging demo:', error);
  } finally {
    // Clean up the subscription
    unsubscribe();
    console.log('Unsubscribed from query-specific logs');
  }
}

// Main function to run all demos
async function main() {
  console.log('Starting HypeQuery Logging and Streaming Demo');

  // Create query builder connected to ClickHouse
  const builder = createQueryBuilder<TestSchema>({
    host: process.env.CLICKHOUSE_HOST || 'http://localhost:8123',
    username: process.env.CLICKHOUSE_USER || 'hypequery',
    password: process.env.CLICKHOUSE_PASSWORD || 'hypequery_test',
    database: process.env.CLICKHOUSE_DB || 'test_db'
  });

  try {
    // Run all demos
    await demoLoggerConfiguration();
    await demoBasicQueryWithLogging(builder);
    await demoStreaming(builder);
    await demoStreamForEach(builder);
    await demoQuerySpecificLogging(builder);

    console.log('\nAll demos completed successfully!');
  } catch (error) {
    console.error('Error running demos:', error);
  }
}

// Run the main function
main().catch(console.error); 