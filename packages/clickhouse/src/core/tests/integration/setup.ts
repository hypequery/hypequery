import { ClickHouseConnection } from '../../connection.js';
import { logger as hypeQueryLogger } from '../../utils/logger.js';
import {
  CLICKHOUSE_CONTAINER_NAME,
  TEST_CONNECTION_CONFIG,
  TEST_DATA,
  detectComposeCommand,
  ensureDockerDaemon,
  isContainerRunning as sharedIsContainerRunning,
  seedClickHouseDatabase,
  startClickHouseContainer as sharedStartClickHouseContainer,
  stopClickHouseContainer as sharedStopClickHouseContainer,
  waitForClickHouse as sharedWaitForClickHouse,
  // @ts-expect-error: shared test harness is plain JS
} from '../../../../../../testing/clickhouse/harness.mjs';

// Disable the hypequery logger to prevent "logs after tests" errors
// This must be done early in the setup, before any queries run
hypeQueryLogger.configure({ enabled: false });

// Setup a logger that respects test environment
const logger = {
  info: (message: string, ...args: any[]) => {
    if (process.env.DEBUG === 'true') {
      console.info(`[INFO] ${message}`, ...args);
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

const config = TEST_CONNECTION_CONFIG;

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
export const isContainerRunning = async (containerName: string): Promise<boolean> => {
  return sharedIsContainerRunning(containerName);
};

// Start the ClickHouse container
export const startClickHouseContainer = async (): Promise<void> => {
  await ensureDockerDaemon();
  const compose = await detectComposeCommand();
  await sharedStartClickHouseContainer({
    compose,
    logger: (message: string) => logger.info(message),
  });
};

// Wait for ClickHouse to be ready
export const waitForClickHouse = async (
  maxAttempts = 30,
  retryInterval = 1000
): Promise<void> => {
  await sharedWaitForClickHouse({
    config,
    maxAttempts,
    retryDelayMs: retryInterval,
    logger: (message: string) => logger.info(message),
  });
};

// Stop the ClickHouse container
export const stopClickHouseContainer = async (): Promise<void> => {
  try {
    const compose = await detectComposeCommand();
    await sharedStopClickHouseContainer({
      compose,
      logger: (message: string) => logger.info(message),
    });
  } catch (error) {
    logger.error('Failed to stop ClickHouse container:', error);
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
    tags: string[];
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

export { CLICKHOUSE_CONTAINER_NAME, TEST_CONNECTION_CONFIG, TEST_DATA };

let hasSetupRun = false;

// Setup the test database
export const setupTestDatabase = async (): Promise<void> => {
  if (process.env.HYPEQUERY_SKIP_TEST_DB_SETUP === 'true') {
    logger.info('Skipping test database setup because HYPEQUERY_SKIP_TEST_DB_SETUP is true.');
    return;
  }

  if (hasSetupRun) {
    return;
  }

  try {
    await seedClickHouseDatabase({
      config,
      data: TEST_DATA,
      logger: (message: string) => logger.info(message),
    });
    hasSetupRun = true;
    logger.info('Test database setup complete');
  } catch (error) {
    hasSetupRun = false;
    logger.error('Failed to set up test database:', error);
    throw error;
  }
}; 
