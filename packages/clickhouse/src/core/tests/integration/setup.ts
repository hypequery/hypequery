import { execSync } from 'child_process';
import { createQueryBuilder } from '../../../index';
import { ClickHouseConnection } from '../../connection';

// Configuration for the test ClickHouse instance
const CLICKHOUSE_HOST = process.env.CLICKHOUSE_TEST_HOST || 'http://localhost:8123';
const CLICKHOUSE_USER = process.env.CLICKHOUSE_TEST_USER || 'hypequery';
const CLICKHOUSE_PASSWORD = process.env.CLICKHOUSE_TEST_PASSWORD || 'hypequery_test';
const CLICKHOUSE_DB = process.env.CLICKHOUSE_TEST_DB || 'test_db';

// Log connection details for debugging
console.log('Initializing ClickHouse connection with:', {
  host: CLICKHOUSE_HOST,
  user: CLICKHOUSE_USER,
  password: CLICKHOUSE_PASSWORD ? 'PROVIDED' : 'NOT_PROVIDED',
  database: CLICKHOUSE_DB
});

// Schema for our test database
export interface TestSchema {
  test_table: {
    id: 'Int32';
    name: 'String';
    price: 'Float64';
    created_at: 'DateTime';
    category: 'String';
    active: 'UInt8';
  };
  users: {
    id: 'Int32';
    user_name: 'String';
    email: 'String';
    created_at: 'DateTime';
    status: 'String';
  };
  orders: {
    id: 'Int32';
    user_id: 'Int32';
    product_id: 'Int32';
    quantity: 'Int32';
    total: 'Float64';
    status: 'String';
    created_at: 'DateTime';
  };
  products: {
    id: 'Int32';
    name: 'String';
    price: 'Float64';
    category: 'String';
    description: 'String';
  };
}

// Helper to initialize the connection
export async function initializeTestConnection() {
  try {
    ClickHouseConnection.initialize({
      host: CLICKHOUSE_HOST,
      username: CLICKHOUSE_USER,
      password: CLICKHOUSE_PASSWORD,
      database: CLICKHOUSE_DB
    });

    // Test the connection
    const client = ClickHouseConnection.getClient();
    await client.ping();
    console.log('ClickHouse connection successfully established');

    return createQueryBuilder<TestSchema>({
      host: CLICKHOUSE_HOST,
      username: CLICKHOUSE_USER,
      password: CLICKHOUSE_PASSWORD,
      database: CLICKHOUSE_DB
    });
  } catch (error) {
    console.error('Failed to initialize ClickHouse connection:', error);
    throw error;
  }
}

// SQL to create test tables
const CREATE_TEST_TABLE = `
CREATE TABLE IF NOT EXISTS test_table (
  id Int32,
  name String,
  price Float64,
  created_at DateTime,
  category String,
  active UInt8
) ENGINE = MergeTree()
ORDER BY id
`;

const CREATE_USERS_TABLE = `
CREATE TABLE IF NOT EXISTS users (
  id Int32,
  user_name String,
  email String,
  created_at DateTime,
  status String
) ENGINE = MergeTree()
ORDER BY id
`;

const CREATE_ORDERS_TABLE = `
CREATE TABLE IF NOT EXISTS orders (
  id Int32,
  user_id Int32,
  product_id Int32,
  quantity Int32,
  total Float64,
  status String,
  created_at DateTime
) ENGINE = MergeTree()
ORDER BY id
`;

const CREATE_PRODUCTS_TABLE = `
CREATE TABLE IF NOT EXISTS products (
  id Int32,
  name String,
  price Float64,
  category String,
  description String
) ENGINE = MergeTree()
ORDER BY id
`;

// Sample data for tests
export const TEST_DATA = {
  test_table: [
    { id: 1, name: 'Product 1', price: 10.99, created_at: '2023-01-01 00:00:00', category: 'A', active: 1 },
    { id: 2, name: 'Product 2', price: 20.50, created_at: '2023-01-02 00:00:00', category: 'B', active: 1 },
    { id: 3, name: 'Product 3', price: 15.75, created_at: '2023-01-03 00:00:00', category: 'A', active: 0 },
    { id: 4, name: 'Product 4', price: 25.00, created_at: '2023-01-04 00:00:00', category: 'C', active: 1 },
    { id: 5, name: 'Product 5', price: 30.25, created_at: '2023-01-05 00:00:00', category: 'B', active: 0 },
    { id: 6, name: 'Product 6', price: 12.99, created_at: '2023-01-06 00:00:00', category: 'A', active: 1 },
    { id: 7, name: 'Product 7', price: 22.50, created_at: '2023-01-07 00:00:00', category: 'B', active: 1 },
    { id: 8, name: 'Product 8', price: 18.75, created_at: '2023-01-08 00:00:00', category: 'C', active: 0 }
  ],
  users: [
    { id: 1, user_name: 'user1', email: 'user1@example.com', created_at: '2023-01-01 00:00:00', status: 'active' },
    { id: 2, user_name: 'user2', email: 'user2@example.com', created_at: '2023-01-02 00:00:00', status: 'active' },
    { id: 3, user_name: 'user3', email: 'user3@example.com', created_at: '2023-01-03 00:00:00', status: 'inactive' },
    { id: 4, user_name: 'user4', email: 'user4@example.com', created_at: '2023-01-04 00:00:00', status: 'active' },
    { id: 5, user_name: 'user5', email: 'user5@example.com', created_at: '2023-01-05 00:00:00', status: 'pending' }
  ],
  orders: [
    { id: 1, user_id: 1, product_id: 1, quantity: 2, total: 21.98, status: 'completed', created_at: '2023-01-10 10:00:00' },
    { id: 2, user_id: 1, product_id: 3, quantity: 1, total: 15.75, status: 'completed', created_at: '2023-01-11 11:00:00' },
    { id: 3, user_id: 2, product_id: 2, quantity: 3, total: 61.50, status: 'completed', created_at: '2023-01-12 12:00:00' },
    { id: 4, user_id: 3, product_id: 5, quantity: 1, total: 30.25, status: 'pending', created_at: '2023-01-13 13:00:00' },
    { id: 5, user_id: 4, product_id: 4, quantity: 2, total: 50.00, status: 'completed', created_at: '2023-01-14 14:00:00' },
    { id: 6, user_id: 2, product_id: 6, quantity: 1, total: 12.99, status: 'cancelled', created_at: '2023-01-15 15:00:00' },
    { id: 7, user_id: 5, product_id: 7, quantity: 4, total: 90.00, status: 'pending', created_at: '2023-01-16 16:00:00' },
    { id: 8, user_id: 1, product_id: 8, quantity: 1, total: 18.75, status: 'completed', created_at: '2023-01-17 17:00:00' }
  ],
  products: [
    { id: 1, name: 'Product A', price: 10.99, category: 'Electronics', description: 'A great electronic device' },
    { id: 2, name: 'Product B', price: 20.50, category: 'Clothing', description: 'Comfortable clothing item' },
    { id: 3, name: 'Product C', price: 15.75, category: 'Electronics', description: 'Another electronic gadget' },
    { id: 4, name: 'Product D', price: 25.00, category: 'Home', description: 'Home decoration item' },
    { id: 5, name: 'Product E', price: 30.25, category: 'Kitchen', description: 'Useful kitchen tool' },
    { id: 6, name: 'Product F', price: 12.99, category: 'Office', description: 'Office supplies' },
    { id: 7, name: 'Product G', price: 22.50, category: 'Electronics', description: 'Premium electronic device' },
    { id: 8, name: 'Product H', price: 18.75, category: 'Clothing', description: 'Stylish clothing piece' }
  ]
};

// Helper to set up the test database
export async function setupTestDatabase() {
  const client = ClickHouseConnection.getClient();

  // Create database if it doesn't exist
  await client.command({
    query: `CREATE DATABASE IF NOT EXISTS ${CLICKHOUSE_DB}`
  });

  // Use the test database
  await client.command({
    query: `USE ${CLICKHOUSE_DB}`
  });

  // Create test tables
  await client.command({
    query: CREATE_TEST_TABLE
  });

  await client.command({
    query: CREATE_USERS_TABLE
  });

  await client.command({
    query: CREATE_ORDERS_TABLE
  });

  await client.command({
    query: CREATE_PRODUCTS_TABLE
  });

  // Truncate tables if they exist
  await client.command({
    query: `TRUNCATE TABLE IF EXISTS test_table`
  });

  await client.command({
    query: `TRUNCATE TABLE IF EXISTS users`
  });

  await client.command({
    query: `TRUNCATE TABLE IF EXISTS orders`
  });

  await client.command({
    query: `TRUNCATE TABLE IF EXISTS products`
  });

  // Insert test data
  // For test_table
  for (const item of TEST_DATA.test_table) {
    await client.command({
      query: `
        INSERT INTO test_table (id, name, price, created_at, category, active)
        VALUES (${item.id}, '${item.name}', ${item.price}, '${item.created_at}', '${item.category}', ${item.active})
      `
    });
  }

  // For users
  for (const user of TEST_DATA.users) {
    await client.command({
      query: `
        INSERT INTO users (id, user_name, email, created_at, status)
        VALUES (${user.id}, '${user.user_name}', '${user.email}', '${user.created_at}', '${user.status}')
      `
    });
  }

  // For orders
  for (const order of TEST_DATA.orders) {
    await client.command({
      query: `
        INSERT INTO orders (id, user_id, product_id, quantity, total, status, created_at)
        VALUES (${order.id}, ${order.user_id}, ${order.product_id}, ${order.quantity}, ${order.total}, '${order.status}', '${order.created_at}')
      `
    });
  }

  // For products
  for (const product of TEST_DATA.products) {
    await client.command({
      query: `
        INSERT INTO products (id, name, price, category, description)
        VALUES (${product.id}, '${product.name}', ${product.price}, '${product.category}', '${product.description}')
      `
    });
  }
}

// Helper to check if Docker is available
export function isDockerAvailable(): boolean {
  try {
    execSync('docker --version', { stdio: 'ignore' });
    return true;
  } catch (error) {
    return false;
  }
}

// Helper to start a ClickHouse Docker container for testing
export function startClickHouseContainer() {
  if (!isDockerAvailable()) {
    console.warn('Docker is not available. Integration tests will use the configured ClickHouse instance.');
    return;
  }

  try {
    // Check if container is already running
    const containerId = execSync('docker ps -q -f name=hypequery-test-clickhouse').toString().trim();
    if (containerId) {
      console.log('ClickHouse test container is already running.');
      return;
    }

    // Start a new container with the hypequery user already configured
    execSync(
      `docker run -d --name hypequery-test-clickhouse -p 8123:8123 -p 9000:9000 --ulimit nofile=262144:262144 -e CLICKHOUSE_USER=${CLICKHOUSE_USER} -e CLICKHOUSE_PASSWORD=${CLICKHOUSE_PASSWORD} -e CLICKHOUSE_DEFAULT_ACCESS_MANAGEMENT=1 clickhouse/clickhouse-server:latest`,
      { stdio: 'inherit' }
    );

    console.log('Started ClickHouse test container with user:', CLICKHOUSE_USER);

    // Wait for ClickHouse to be ready
    let attempts = 0;
    const maxAttempts = 30;
    while (attempts < maxAttempts) {
      try {
        execSync('curl -s http://localhost:8123/ping', { stdio: 'ignore' });
        console.log('ClickHouse is ready.');
        break;
      } catch (error) {
        attempts++;
        if (attempts >= maxAttempts) {
          throw new Error('ClickHouse failed to start in time.');
        }
        console.log(`Waiting for ClickHouse to be ready... (${attempts}/${maxAttempts})`);
        execSync('sleep 1');
      }
    }

    // Create the test database
    try {
      execSync(`
        docker exec hypequery-test-clickhouse clickhouse-client -u ${CLICKHOUSE_USER} --password ${CLICKHOUSE_PASSWORD} --query "CREATE DATABASE IF NOT EXISTS ${CLICKHOUSE_DB}"
      `, { stdio: 'inherit' });
      console.log(`Created database '${CLICKHOUSE_DB}'.`);
    } catch (error) {
      console.error('Failed to create database:', error);
      throw error;
    }
  } catch (error) {
    console.error('Failed to start ClickHouse container:', error);
    throw error;
  }
}

// Helper to stop the ClickHouse Docker container
export function stopClickHouseContainer() {
  if (!isDockerAvailable()) {
    return;
  }

  try {
    execSync('docker stop hypequery-test-clickhouse', { stdio: 'ignore' });
    execSync('docker rm hypequery-test-clickhouse', { stdio: 'ignore' });
    console.log('Stopped and removed ClickHouse test container.');
  } catch (error) {
    console.error('Failed to stop ClickHouse container:', error);
  }
} 