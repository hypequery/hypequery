import { exec } from 'node:child_process';
import { promisify } from 'node:util';
import { logger } from './logger.js';

const execAsync = promisify(exec);

const CONTAINER_NAME = 'hypequery-clickhouse';
const CLICKHOUSE_IMAGE = 'clickhouse/clickhouse-server:latest';
const CLICKHOUSE_PORT = 8123;
const CLICKHOUSE_DATABASE = 'hypequery_demo';

export interface DockerClickHouseConfig {
  host: string;
  database: string;
  username: string;
  password: string;
}

/**
 * Check if Docker is available and running
 */
export async function isDockerAvailable(): Promise<boolean> {
  try {
    await execAsync('docker info', { timeout: 5000 });
    return true;
  } catch {
    return false;
  }
}

/**
 * Check if the hypequery ClickHouse container already exists
 */
export async function containerExists(): Promise<boolean> {
  try {
    const { stdout } = await execAsync(
      `docker ps -a --filter "name=${CONTAINER_NAME}" --format "{{.Names}}"`
    );
    return stdout.trim() === CONTAINER_NAME;
  } catch {
    return false;
  }
}

/**
 * Check if the hypequery ClickHouse container is running
 */
export async function isContainerRunning(): Promise<boolean> {
  try {
    const { stdout } = await execAsync(
      `docker ps --filter "name=${CONTAINER_NAME}" --filter "status=running" --format "{{.Names}}"`
    );
    return stdout.trim() === CONTAINER_NAME;
  } catch {
    return false;
  }
}

/**
 * Start an existing container
 */
export async function startContainer(): Promise<void> {
  await execAsync(`docker start ${CONTAINER_NAME}`);
}

/**
 * Create and start a new ClickHouse container
 */
export async function createContainer(): Promise<void> {
  await execAsync(
    `docker run -d --name ${CONTAINER_NAME} -p ${CLICKHOUSE_PORT}:8123 ${CLICKHOUSE_IMAGE}`
  );
}

/**
 * Wait for ClickHouse to be ready to accept connections
 */
export async function waitForClickHouse(maxAttempts = 30): Promise<boolean> {
  for (let i = 0; i < maxAttempts; i++) {
    try {
      const response = await fetch(`http://localhost:${CLICKHOUSE_PORT}/ping`);
      if (response.ok) {
        return true;
      }
    } catch {
      // Not ready yet
    }
    await sleep(1000);
  }
  return false;
}

/**
 * Execute a SQL query against the local ClickHouse
 */
async function executeSQL(sql: string, database?: string): Promise<string> {
  const url = new URL(`http://localhost:${CLICKHOUSE_PORT}/`);
  if (database) {
    url.searchParams.set('database', database);
  }

  const response = await fetch(url.toString(), {
    method: 'POST',
    body: sql,
    headers: {
      'Content-Type': 'text/plain',
    },
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`ClickHouse query failed: ${error}`);
  }

  return response.text();
}

/**
 * Check if sample data already exists
 */
async function hasExistingData(): Promise<boolean> {
  try {
    const result = await executeSQL('SELECT count() FROM users', CLICKHOUSE_DATABASE);
    return parseInt(result.trim(), 10) > 0;
  } catch {
    return false;
  }
}

/**
 * Create the demo database and seed it with sample data
 */
export async function seedDatabase(): Promise<void> {
  // Create database
  await executeSQL(`CREATE DATABASE IF NOT EXISTS ${CLICKHOUSE_DATABASE}`);

  // Create tables (idempotent via IF NOT EXISTS)
  await executeSQL(
    `
    CREATE TABLE IF NOT EXISTS users (
      id UInt64,
      name String,
      email String,
      created_at DateTime DEFAULT now(),
      plan String DEFAULT 'free'
    ) ENGINE = MergeTree()
    ORDER BY id
    `,
    CLICKHOUSE_DATABASE
  );

  await executeSQL(
    `
    CREATE TABLE IF NOT EXISTS orders (
      id UInt64,
      user_id UInt64,
      amount Decimal(10, 2),
      currency String DEFAULT 'USD',
      status String,
      created_at DateTime DEFAULT now()
    ) ENGINE = MergeTree()
    ORDER BY id
    `,
    CLICKHOUSE_DATABASE
  );

  await executeSQL(
    `
    CREATE TABLE IF NOT EXISTS page_events (
      event_id UUID DEFAULT generateUUIDv4(),
      user_id UInt64,
      page String,
      action String,
      timestamp DateTime DEFAULT now()
    ) ENGINE = MergeTree()
    ORDER BY timestamp
    `,
    CLICKHOUSE_DATABASE
  );

  // Seed sample data (skip if already seeded)
  if (await hasExistingData()) {
    return;
  }

  await executeSQL(
    `
    INSERT INTO users (id, name, email, plan, created_at) VALUES
      (1, 'Alice Johnson', 'alice@example.com', 'pro', now() - INTERVAL 30 DAY),
      (2, 'Bob Smith', 'bob@example.com', 'free', now() - INTERVAL 25 DAY),
      (3, 'Carol White', 'carol@example.com', 'enterprise', now() - INTERVAL 20 DAY),
      (4, 'David Brown', 'david@example.com', 'pro', now() - INTERVAL 15 DAY),
      (5, 'Eve Davis', 'eve@example.com', 'free', now() - INTERVAL 10 DAY),
      (6, 'Frank Miller', 'frank@example.com', 'pro', now() - INTERVAL 5 DAY),
      (7, 'Grace Wilson', 'grace@example.com', 'free', now() - INTERVAL 3 DAY),
      (8, 'Henry Taylor', 'henry@example.com', 'enterprise', now() - INTERVAL 2 DAY),
      (9, 'Ivy Anderson', 'ivy@example.com', 'pro', now() - INTERVAL 1 DAY),
      (10, 'Jack Thomas', 'jack@example.com', 'free', now())
    `,
    CLICKHOUSE_DATABASE
  );

  await executeSQL(
    `
    INSERT INTO orders (id, user_id, amount, currency, status, created_at) VALUES
      (1, 1, 99.99, 'USD', 'completed', now() - INTERVAL 28 DAY),
      (2, 1, 149.99, 'USD', 'completed', now() - INTERVAL 20 DAY),
      (3, 2, 29.99, 'USD', 'completed', now() - INTERVAL 22 DAY),
      (4, 3, 499.99, 'USD', 'completed', now() - INTERVAL 18 DAY),
      (5, 4, 99.99, 'USD', 'pending', now() - INTERVAL 12 DAY),
      (6, 5, 29.99, 'USD', 'refunded', now() - INTERVAL 8 DAY),
      (7, 6, 149.99, 'USD', 'completed', now() - INTERVAL 4 DAY),
      (8, 7, 29.99, 'USD', 'completed', now() - INTERVAL 2 DAY),
      (9, 8, 499.99, 'USD', 'pending', now() - INTERVAL 1 DAY),
      (10, 9, 99.99, 'USD', 'completed', now()),
      (11, 1, 199.99, 'EUR', 'completed', now() - INTERVAL 15 DAY),
      (12, 3, 299.99, 'EUR', 'completed', now() - INTERVAL 10 DAY),
      (13, 4, 79.99, 'GBP', 'completed', now() - INTERVAL 6 DAY),
      (14, 6, 199.99, 'USD', 'pending', now() - INTERVAL 3 DAY),
      (15, 10, 29.99, 'USD', 'completed', now())
    `,
    CLICKHOUSE_DATABASE
  );

  await executeSQL(
    `
    INSERT INTO page_events (user_id, page, action, timestamp) VALUES
      (1, '/dashboard', 'view', now() - INTERVAL 2 HOUR),
      (1, '/settings', 'view', now() - INTERVAL 1 HOUR),
      (2, '/home', 'view', now() - INTERVAL 3 HOUR),
      (2, '/pricing', 'view', now() - INTERVAL 2 HOUR),
      (2, '/pricing', 'click', now() - INTERVAL 2 HOUR),
      (3, '/dashboard', 'view', now() - INTERVAL 4 HOUR),
      (3, '/reports', 'view', now() - INTERVAL 3 HOUR),
      (3, '/reports', 'export', now() - INTERVAL 3 HOUR),
      (4, '/home', 'view', now() - INTERVAL 5 HOUR),
      (5, '/home', 'view', now() - INTERVAL 1 HOUR),
      (5, '/docs', 'view', now() - INTERVAL 30 MINUTE),
      (6, '/dashboard', 'view', now() - INTERVAL 20 MINUTE),
      (7, '/home', 'view', now() - INTERVAL 15 MINUTE),
      (8, '/pricing', 'view', now() - INTERVAL 10 MINUTE),
      (9, '/dashboard', 'view', now() - INTERVAL 5 MINUTE),
      (10, '/home', 'view', now())
    `,
    CLICKHOUSE_DATABASE
  );
}

/**
 * Get the connection config for the local Docker ClickHouse
 */
export function getDockerConnectionConfig(): DockerClickHouseConfig {
  return {
    host: `http://localhost:${CLICKHOUSE_PORT}`,
    database: CLICKHOUSE_DATABASE,
    username: 'default',
    password: '',
  };
}

/**
 * Full flow: ensure Docker ClickHouse is running and seeded
 */
export async function ensureDockerClickHouse(): Promise<DockerClickHouseConfig | null> {
  // Check Docker availability
  if (!(await isDockerAvailable())) {
    logger.error('Docker is not available. Please install and start Docker first.');
    logger.newline();
    logger.info('Install Docker: https://docs.docker.com/get-docker/');
    return null;
  }

  // Check if container exists
  const exists = await containerExists();
  const running = exists && (await isContainerRunning());

  if (running) {
    logger.info('Using existing hypequery-clickhouse container');
  } else if (exists) {
    logger.info('Starting existing hypequery-clickhouse container...');
    await startContainer();
  } else {
    logger.info('Creating new ClickHouse container...');
    await createContainer();
  }

  // Wait for ClickHouse to be ready
  const ready = await waitForClickHouse();
  if (!ready) {
    logger.error('ClickHouse container failed to start. Check Docker logs:');
    logger.indent(`docker logs ${CONTAINER_NAME}`);
    return null;
  }

  // Seed database (idempotent - uses IF NOT EXISTS)
  if (!exists) {
    logger.info('Seeding sample data...');
    await seedDatabase();
  }

  return getDockerConnectionConfig();
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
