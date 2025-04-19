/**
 * Centralized configuration for integration tests
 * Import this in all integration test files to ensure consistent behavior
 */

/**
 * Whether to skip integration tests:
 * - Skip if SKIP_INTEGRATION_TESTS is explicitly set to 'true'
 * - In CI environments, skip unless ENABLE_CI_INTEGRATION_TESTS is set to 'true'
 */
export const SKIP_INTEGRATION_TESTS =
  process.env.SKIP_INTEGRATION_TESTS === 'true' ||
  (process.env.CI === 'true' && process.env.ENABLE_CI_INTEGRATION_TESTS !== 'true');

/**
 * Default timeout for test setup (in milliseconds)
 */
export const SETUP_TIMEOUT = 30000; 