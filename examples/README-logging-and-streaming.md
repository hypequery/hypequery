# HypeQuery Logging and Streaming Examples

This example demonstrates how to use HypeQuery's logging and streaming features to:
1. Configure the logger for detailed insights into query execution
2. Process large datasets efficiently with streaming
3. Use the `streamForEach` helper method
4. Subscribe to logs for specific queries

## Prerequisites

- Node.js (v18 or later recommended)
- A running ClickHouse instance (see setup instructions below)
- TypeScript and ts-node installed (for running the example)

## Setting Up ClickHouse

### Option 1: Docker (Recommended)

The easiest way to run ClickHouse locally is with Docker:

```bash
# Start a ClickHouse container
docker run -d --name hypequery-example \
  -p 8123:8123 -p 9000:9000 \
  -e CLICKHOUSE_USER=hypequery \
  -e CLICKHOUSE_PASSWORD=hypequery_test \
  -e CLICKHOUSE_DEFAULT_ACCESS_MANAGEMENT=1 \
  clickhouse/clickhouse-server:latest
```

### Option 2: Use an Existing ClickHouse Instance

If you have an existing ClickHouse instance, modify the connection details in the example file to point to your instance.

## Creating the Test Table

To run the examples successfully, you need a `users` table. You can create it with:

```sql
CREATE TABLE test_db.users (
  id Int32,
  name String,
  email String,
  age Int32,
  created_at DateTime
) ENGINE = MergeTree()
ORDER BY id
```

And insert some sample data:

```sql
INSERT INTO test_db.users (id, name, email, age, created_at)
VALUES
  (1, 'John Doe', 'john@example.com', 30, now()),
  (2, 'Jane Smith', 'jane@example.com', 25, now()),
  (3, 'Bob Johnson', 'bob@example.com', 40, now()),
  (4, 'Alice Williams', 'alice@example.com', 35, now()),
  (5, 'Charlie Brown', 'charlie@example.com', 28, now());
```

You can execute these commands using ClickHouse client:

```bash
# If using Docker
docker exec -it hypequery-example clickhouse-client -u hypequery --password hypequery_test
```

## Running the Example

First, install dependencies:

```bash
# From the repository root
npm install
# Or from the examples directory
cd examples && npm install
```

Then run the example:

```bash
# Using ts-node
npx ts-node examples/logging-and-streaming-example.ts
```

## What the Example Shows

### 1. Logger Configuration

See how to configure the HypeQuery logger with custom log levels and handlers:

```typescript
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
```

### 2. Streaming Large Result Sets

Learn how to process large datasets without loading everything into memory:

```typescript
const stream = await builder
  .table('users')
  .select(['id', 'name', 'email'])
  .stream();

const reader = stream.getReader();
try {
  while (true) {
    const { done, value: rows } = await reader.read();
    if (done) break;
    
    // Process each batch of rows
    processRows(rows);
  }
} finally {
  reader.releaseLock();
}
```

### 3. Using the `streamForEach` Helper

See how to use the convenient `streamForEach` helper method:

```typescript
await builder
  .table('users')
  .select(['id', 'name', 'email'])
  .streamForEach(row => {
    // Process each row individually
    processRow(row);
  });
```

### 4. Query-Specific Logging

Learn how to subscribe to logs for specific queries:

```typescript
const queryId = 'my-important-query';
const unsubscribe = logger.subscribeToQuery(queryId, (log) => {
  console.log(`Received log for query ${queryId}:`, log);
});

// When done
unsubscribe();
```

## Cleanup

When you're done, you can stop and remove the ClickHouse container:

```bash
docker stop hypequery-example
docker rm hypequery-example
``` 