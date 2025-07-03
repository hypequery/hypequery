import path from 'path';
import { fileURLToPath } from 'url';
import { ClickHouseConnection } from '../../connection';
import { exec } from 'child_process';
import { promisify } from 'util';
import { logger as hypeQueryLogger } from '../../utils/logger';

// Disable the hypequery logger to prevent "logs after tests" errors
// This must be done early in the setup, before any queries run
hypeQueryLogger.configure({ enabled: false });

// Setup a logger that respects test environment
const logger = {
  info: (message: string, ...args: any[]) => {
    if (process.env.DEBUG === 'true') {
    }
  },
  error: (message: string, ...args: any[]) => {
    if (process.env.DEBUG === 'true' || process.env.SUPPRESS_ERRORS !== 'true') {
      console.error(`[ERROR] ${message}`, ...args);
    }
  },
  warn: (message: string, ...args: any[]) => {
    if (process.env.DEBUG === 'true') {
      console.warn(`[WARN] ${message}`, ...args);
    }
  }
};

const execAsync = promisify(exec);

// Create a path to the project root
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, '../../../../../');

// Connection configuration (with defaults that can be overridden by env variables)
const config = {
  host: process.env.CLICKHOUSE_TEST_HOST || 'http://localhost:8123',
  user: process.env.CLICKHOUSE_TEST_USER || 'default',
  password: process.env.CLICKHOUSE_TEST_PASSWORD || 'hypequery_test',
  database: process.env.CLICKHOUSE_TEST_DB || 'test_db',
};

// Initialize the ClickHouse connection
export const initializeTestConnection = async () => {
  logger.info('Initializing ClickHouse connection with config:', config);

  try {
    // Make sure ClickHouse is initialized
    ensureConnectionInitialized();

    // Test connection by getting client and pinging
    const client = ClickHouseConnection.getClient();
    await client.ping();

    logger.info('ClickHouse connection successful');

    // Return the query builder from the index file
    const { createQueryBuilder } = await import('../../../index.js');
    return createQueryBuilder({
      host: config.host,
      username: config.user,
      password: config.password,
      database: config.database,
    });
  } catch (error) {
    logger.error('Failed to connect to ClickHouse:', error);
    throw error;
  }
};

// Helper function to ensure connection is initialized
export const ensureConnectionInitialized = () => {
  // If connection hasn't been initialized yet, initialize it
  try {
    ClickHouseConnection.getClient();
  } catch (error) {
    // If we get "not initialized" error, initialize the connection
    logger.info('Initializing ClickHouse connection...');
    ClickHouseConnection.initialize({
      host: config.host,
      username: config.user,
      password: config.password,
      database: config.database,
    });
  }
  return ClickHouseConnection.getClient();
};

// Check if Docker is installed
export const isDockerAvailable = async (): Promise<boolean> => {
  try {
    await execAsync('docker --version');
    return true;
  } catch (error) {
    return false;
  }
};

// Check if Docker Compose is installed
export const isDockerComposeAvailable = async (): Promise<boolean> => {
  try {
    await execAsync('docker compose version');
    return true;
  } catch (error) {
    try {
      // Try the hyphenated version for older installations
      await execAsync('docker-compose --version');
      return true;
    } catch {
      return false;
    }
  }
};

// Check if a docker container is running
export const isContainerRunning = async (containerName: string): Promise<boolean> => {
  try {
    const { stdout } = await execAsync(`docker ps --filter "name=${containerName}" --format "{{.Names}}"`);
    return stdout.trim() === containerName;
  } catch (error) {
    return false;
  }
};

// Check if ClickHouse is ready
export const isClickHouseReady = async (): Promise<boolean> => {
  try {
    const client = ClickHouseConnection.getClient();
    await client.ping();
    return true;
  } catch (error) {
    return false;
  }
};

// Start the ClickHouse container
export const startClickHouseContainer = async (): Promise<void> => {
  const dockerAvailable = await isDockerAvailable();
  if (!dockerAvailable) {
    throw new Error('Docker is not available. Please install Docker to run integration tests.');
  }

  const composeAvailable = await isDockerComposeAvailable();

  // Use Docker Compose if available
  if (composeAvailable) {
    logger.info('Starting ClickHouse container with Docker Compose...');
    try {
      // Fix the path to the docker-compose.test.yml file
      const composePath = path.resolve(projectRoot, 'packages/clickhouse/docker-compose.test.yml');
      logger.info(`Using Docker Compose file at: ${composePath}`);

      // Make sure we're executing the command from the correct directory
      await execAsync(`docker compose -f "${composePath}" up -d`);
    } catch (error) {
      logger.error('Failed to start ClickHouse container with Docker Compose:', error);
      throw error;
    }
  } else {
    // Fallback to Docker run
    logger.info('Starting ClickHouse container with Docker...');
    try {
      await execAsync(`
        docker run -d --name hypequery-test-clickhouse 
        -p 8123:8123 -p 9000:9000
        -e CLICKHOUSE_USER=${config.user}
        -e CLICKHOUSE_PASSWORD=${config.password}
        -e CLICKHOUSE_DB=${config.database}
        --ulimit nofile=262144:262144
        clickhouse/clickhouse-server:latest
      `);
    } catch (error) {
      logger.error('Failed to start ClickHouse container with Docker:', error);
      throw error;
    }
  }
};

// Wait for ClickHouse to be ready
export const waitForClickHouse = async (
  maxAttempts = 30,
  retryInterval = 1000
): Promise<void> => {
  logger.info('Waiting for ClickHouse to be ready...');

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    if (await isClickHouseReady()) {
      logger.info('ClickHouse is ready!');
      return;
    }
    logger.info(`Waiting for ClickHouse... Attempt ${attempt}/${maxAttempts}`);
    await new Promise(resolve => setTimeout(resolve, retryInterval));
  }

  throw new Error(`ClickHouse failed to start after ${maxAttempts} attempts`);
};

// Stop the ClickHouse container
export const stopClickHouseContainer = async (): Promise<void> => {
  const composeAvailable = await isDockerComposeAvailable();

  if (composeAvailable) {
    logger.info('Stopping ClickHouse container with Docker Compose...');
    try {
      // Fix the path to the docker-compose.test.yml file
      const composePath = path.resolve(projectRoot, 'packages/clickhouse/docker-compose.test.yml');
      logger.info(`Using Docker Compose file at: ${composePath}`);

      // Make sure we're executing the command from the correct directory
      await execAsync(`docker compose -f "${composePath}" down -v`);
    } catch (error) {
      logger.error('Failed to stop ClickHouse container with Docker Compose:', error);
      // Log the error but don't throw, so the tests can complete
      // This allows for manual cleanup if needed
    }
  } else {
    logger.info('Stopping ClickHouse container with Docker...');
    try {
      await execAsync('docker stop hypequery-test-clickhouse && docker rm hypequery-test-clickhouse');
    } catch (error) {
      logger.error('Failed to stop ClickHouse container with Docker:', error);
      // Log the error but don't throw, so the tests can complete
    }
  }
};

// Define the test schema types
export interface TestSchemaType {
  test_table: Array<{
    id: number;
    name: string;
    category: string;
    price: number;
    created_at: string;
    is_active: boolean;
  }>;
  users: Array<{
    id: number;
    user_name: string;
    email: string;
    status: string;
    created_at: string;
  }>;
  orders: Array<{
    id: number;
    user_id: number;
    product_id: number;
    quantity: number;
    total: number;
    status: string;
    created_at: string;
  }>;
}

// Test data
export const TEST_DATA: TestSchemaType = {
  test_table: [
    { id: 1, name: 'Product A', category: 'A', price: 10.5, created_at: '2023-01-01', is_active: true },
    { id: 2, name: 'Product B', category: 'B', price: 20.75, created_at: '2023-01-02', is_active: true },
    { id: 3, name: 'Product C', category: 'A', price: 15.0, created_at: '2023-01-03', is_active: false },
    { id: 4, name: 'Product D', category: 'C', price: 8.25, created_at: '2023-01-04', is_active: true },
    { id: 5, name: 'Product E', category: 'B', price: 30.0, created_at: '2023-01-05', is_active: true },
  ],
  users: [
    { id: 1, user_name: 'john_doe', email: 'john@example.com', status: 'active', created_at: '2023-01-01' },
    { id: 2, user_name: 'jane_smith', email: 'jane@example.com', status: 'active', created_at: '2023-01-02' },
    { id: 3, user_name: 'bob_jones', email: 'bob@example.com', status: 'inactive', created_at: '2023-01-03' },
  ],
  orders: [
    { id: 1, user_id: 1, product_id: 1, quantity: 2, total: 21.0, status: 'completed', created_at: '2023-01-10' },
    { id: 2, user_id: 1, product_id: 3, quantity: 1, total: 15.0, status: 'completed', created_at: '2023-01-11' },
    { id: 3, user_id: 2, product_id: 2, quantity: 3, total: 62.25, status: 'pending', created_at: '2023-01-12' },
    { id: 4, user_id: 2, product_id: 5, quantity: 1, total: 30.0, status: 'completed', created_at: '2023-01-13' },
    { id: 5, user_id: 3, product_id: 4, quantity: 2, total: 16.5, status: 'cancelled', created_at: '2023-01-14' },
  ],
};

// Setup the test database
export const setupTestDatabase = async (): Promise<void> => {
  // Make sure connection is initialized before getting client
  const client = ensureConnectionInitialized();

  try {
    // Create and use database if it doesn't exist
    await client.exec({ query: `CREATE DATABASE IF NOT EXISTS ${config.database}` });
    await client.exec({ query: `USE ${config.database}` });

    // Drop tables if they exist
    await client.exec({ query: 'DROP TABLE IF EXISTS test_table' });
    await client.exec({ query: 'DROP TABLE IF EXISTS users' });
    await client.exec({ query: 'DROP TABLE IF EXISTS orders' });

    // Create tables
    await client.exec({
      query: `
        CREATE TABLE test_table (
          id UInt32,
          name String,
          category String,
          price Float64,
          created_at Date,
          is_active Boolean
        ) ENGINE = MergeTree()
        ORDER BY id
      `
    });

    await client.exec({
      query: `
        CREATE TABLE users (
          id UInt32,
          user_name String,
          email String,
          status String,
          created_at Date
        ) ENGINE = MergeTree()
        ORDER BY id
      `
    });

    await client.exec({
      query: `
        CREATE TABLE orders (
          id UInt32,
          user_id UInt32,
          product_id UInt32,
          quantity UInt32,
          total Float64,
          status String,
          created_at Date
        ) ENGINE = MergeTree()
        ORDER BY id
      `
    });

    // Insert test data
    for (const row of TEST_DATA.test_table) {
      await client.insert({
        table: 'test_table',
        values: [row],
        format: 'JSONEachRow'
      });
    }

    for (const row of TEST_DATA.users) {
      await client.insert({
        table: 'users',
        values: [row],
        format: 'JSONEachRow'
      });
    }

    for (const row of TEST_DATA.orders) {
      await client.insert({
        table: 'orders',
        values: [row],
        format: 'JSONEachRow'
      });
    }

    logger.info('Test database setup complete');
  } catch (error) {
    logger.error('Failed to set up test database:', error);
    throw error;
  }
}; 