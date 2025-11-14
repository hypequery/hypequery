/**
 * Minimal Browser Example for HypeQuery
 *
 * This demonstrates how to use @hypequery/clickhouse in a browser environment
 * with manual client injection using @clickhouse/client-web.
 */

import { createClient } from '@clickhouse/client-web';
import { createQueryBuilder } from '@hypequery/clickhouse';

// DOM elements
const statusEl = document.getElementById('status');
const queryOutputEl = document.getElementById('query-output');

function setStatus(message, isError = false) {
  statusEl.textContent = message;
  statusEl.className = isError ? 'status error' : 'status success';
}

function setQueryOutput(output) {
  queryOutputEl.textContent = output;
}

try {
  setStatus('✅ Successfully imported @hypequery/clickhouse and @clickhouse/client-web!');

  // Create the ClickHouse web client
  // Note: In a real application, you would provide actual connection details
  // For this example, we're just demonstrating that the imports work
  const client = createClient({
    host: 'http://localhost:8123',
    // Add your connection details here:
    // username: 'default',
    // password: '',
    // database: 'default'
  });

  // Create query builder with manual injection
  const db = createQueryBuilder({
    client
  });

  // Example: Build a type-safe query (without executing)
  // Define a simple schema for demonstration
  const exampleQuery = db.table('my_table')
    .select(['id', 'name', 'created_at'])
    .where('status', 'eq', 'active')
    .limit(10);

  // Get the SQL without executing
  const sql = exampleQuery.toSQL();

  setQueryOutput(`Generated SQL Query:\n\n${sql}\n\nNote: This example demonstrates building queries without executing them.\nTo execute queries, provide valid ClickHouse connection details above.`);

  console.log('✅ Browser compatibility verified!');
  console.log('📦 Package successfully bundled for browser');
  console.log('🔍 Generated SQL:', sql);

} catch (error) {
  console.error('❌ Error:', error);
  setStatus(`❌ Error: ${error.message}`, true);
  setQueryOutput(`Error Details:\n\n${error.stack}`);

  // This error means the browser compatibility issue has occurred
  if (error.message.includes('buffer') || error.message.includes('process')) {
    setStatus(
      '❌ Browser Compatibility Issue Detected! ' +
      'Node.js dependencies are being bundled. ' +
      'Check that @hypequery/clickhouse is using dynamic imports.',
      true
    );
  }
}
