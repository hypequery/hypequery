/**
 * Common initialization for all integration tests
 * Import this at the beginning of each test file to ensure consistent setup
 */

import {
  startClickHouseContainer,
  waitForClickHouse,
  ensureConnectionInitialized,
  setupTestDatabase
} from './setup';

export const skipIntegrationTests = () => {
  return process.env.SKIP_INTEGRATION_TESTS === 'true' || process.env.CI === 'true';
};

export const initializeForTest = async (): Promise<void> => {
  if (skipIntegrationTests()) {
    return;
  }

  try {
    // Initialize the connection
    ensureConnectionInitialized();

    // Make sure container is running
    await startClickHouseContainer();

    // Wait for ClickHouse to be ready
    await waitForClickHouse();

    // Set up the test database
    await setupTestDatabase();
  } catch (error) {
    console.error('Failed to initialize test environment:', error);
    throw error;
  }
};

// Automatically initialize when this module is imported
initializeForTest().catch(error => {
  console.error('Test initialization failed:', error);
  process.exit(1);
}); 