import type { ClickHouseSettings } from '@clickhouse/client-common';
import type { ClickHouseClient as NodeClickHouseClient } from '@clickhouse/client';
import type { ClickHouseClient as WebClickHouseClient } from '@clickhouse/client-web';
import type { ClickHouseConfig } from './query-builder.js';
type ClickHouseClient = NodeClickHouseClient | WebClickHouseClient;
/**
 * The main entry point for connecting to a ClickHouse database.
 * Provides static methods to initialize the connection and retrieve the client.
 *
 * Supports two modes of operation:
 * 1. **Manual injection**: Provide a client instance via `config.client` (required for browser environments)
 * 2. **Auto-detection**: Automatically uses @clickhouse/client for Node.js environments
 *
 * @category Core
 * @example
 * ```typescript
 * // Method 1: Manual injection (required for browser environments)
 * import { createClient } from '@clickhouse/client-web';
 * const client = createClient({
 *   host: 'http://localhost:8123',
 *   username: 'default',
 *   password: 'password'
 * });
 *
 * ClickHouseConnection.initialize({
 *   host: 'http://localhost:8123',
 *   database: 'my_database',
 *   client // Explicitly provide the client
 * });
 *
 * // Method 2: Auto-detection (Node.js environments only)
 * ClickHouseConnection.initialize({
 *   host: 'http://localhost:8123',
 *   username: 'default',
 *   password: 'password',
 *   database: 'my_database'
 * });
 *
 * // Get the client to execute queries directly
 * const client = ClickHouseConnection.getClient();
 * const result = await client.query({
 *   query: 'SELECT * FROM my_table',
 *   format: 'JSONEachRow'
 * });
 * ```
 *
 * @note This library requires one of the following peer dependencies:
 * - @clickhouse/client (for Node.js environments)
 * - @clickhouse/client-web (for browser environments)
 *
 * **Important**: Browser environments require manual injection because `require()` calls don't work in browsers.
 */
export declare class ClickHouseConnection {
    private static instance;
    private static clientModule;
    /**
     * Initializes the ClickHouse connection with the provided configuration.
     * This method must be called before any queries can be executed.
     *
     * **Priority order:**
     * 1. If `config.client` is provided, use it directly (manual injection)
     * 2. Otherwise, auto-detect @clickhouse/client for Node.js environments
     *
     * **Note**: Browser environments require manual injection because `require()` calls don't work in browsers.
     *
     * @param config - The connection configuration options
     * @returns The ClickHouseConnection class for method chaining
     * @throws Will throw an error if no ClickHouse client is available
     *
     * @example
     * ```typescript
     * // Manual injection (required for browser environments)
     * import { createClient } from '@clickhouse/client-web';
     * const client = createClient({ host: 'http://localhost:8123' });
     * ClickHouseConnection.initialize({ host: 'http://localhost:8123', client });
     *
     * // Auto-detection (Node.js environments only)
     * ClickHouseConnection.initialize({
     *   host: 'http://localhost:8123',
     *   username: 'default',
     *   password: 'password',
     *   database: 'my_database'
     * });
     * ```
     */
    static initialize(config: ClickHouseConfig): typeof ClickHouseConnection;
    /**
     * Retrieves the ClickHouse client instance for direct query execution.
     *
     * @returns The ClickHouse client instance
     * @throws Will throw an error if the connection has not been initialized
     *
     * @example
     * ```typescript
     * const client = ClickHouseConnection.getClient();
     * const result = await client.query({
     *   query: 'SELECT * FROM my_table',
     *   format: 'JSONEachRow'
     * });
     * ```
     */
    static getClient(): ClickHouseClient;
    /**
     * Gets the ClickHouseSettings type from the loaded client module.
     * Only available when using auto-detection (not manual injection).
     *
     * @returns The ClickHouseSettings type or an empty object if not available
     */
    static getClickHouseSettings(): ClickHouseSettings;
}
export {};
//# sourceMappingURL=connection.d.ts.map