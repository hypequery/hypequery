/**
 * Centralized configuration for integration tests
 * Import this in all integration test files to ensure consistent behavior
 */

/**
 * Whether to skip integration tests:
 * - Only skip when SKIP_INTEGRATION_TESTS is explicitly set to 'true'
 *   (used locally when ClickHouse is unavailable)
 */
export const SKIP_INTEGRATION_TESTS = process.env.SKIP_INTEGRATION_TESTS === 'true';

/**
 * Default timeout for test setup (in milliseconds)
 */
export const SETUP_TIMEOUT = 30000; 
