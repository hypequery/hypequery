/**
 * Centralized configuration for integration tests
 * Import this in all integration test files to ensure consistent behavior
 */
/**
 * Whether to skip integration tests:
 * - Only skip when SKIP_INTEGRATION_TESTS is explicitly set to 'true'
 *   (used locally when ClickHouse is unavailable)
 */
export declare const SKIP_INTEGRATION_TESTS: boolean;
/**
 * Default timeout for test setup (in milliseconds)
 */
export declare const SETUP_TIMEOUT = 30000;
//# sourceMappingURL=test-config.d.ts.map