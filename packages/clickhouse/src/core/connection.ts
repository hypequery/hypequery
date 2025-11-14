/**
 * ⚠️ IMPORTANT: Browser Compatibility Warning ⚠️
 *
 * DO NOT add static imports of Node.js-only packages in this file!
 *
 * ❌ WRONG: import { ... } from '@' + 'clickhouse/client' (static import)
 * ✅ CORRECT: Use dynamic require() inside getClickHouseClientSync()
 *
 * Static imports cause bundlers (webpack/Next.js/Vite) to include Node.js
 * dependencies in browser bundles, breaking browser compatibility even when
 * users correctly use manual injection with @clickhouse/client-web.
 *
 * The build verification script (scripts/verify-build.js) will fail if
 * static imports of Node.js packages are detected.
 */

import type { ClickHouseSettings } from '@clickhouse/client-common';
import type { ClickHouseClient as NodeClickHouseClient } from '@clickhouse/client';
import type { ClickHouseClient as WebClickHouseClient } from '@clickhouse/client-web';
import type { ClickHouseConfig } from './query-builder.js';
import { isClientConfig } from './query-builder.js';

// Union type that accepts either client type
type ClickHouseClient = NodeClickHouseClient | WebClickHouseClient;

interface ClickHouseClientModule {
  createClient: (config: ClickHouseConfig) => ClickHouseClient;
  ClickHouseSettings?: ClickHouseSettings;
}

// Function to synchronously get the appropriate client
function getClickHouseClientSync(): ClickHouseClientModule {
  const isDev = process.env.NODE_ENV === 'development';
  const isNode = typeof process !== 'undefined' && process.versions && process.versions.node;

  // In Node.js environment, use Node.js client only
  if (isNode) {
    // Use dynamic import to avoid bundling Node.js client in browser builds
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const clientNode = require('@clickhouse/client');
    if (isDev) {
      console.log('hypequery: Using @clickhouse/client for Node.js environment');
    }
    return {
      createClient: clientNode.createClient,
      ClickHouseSettings: clientNode.ClickHouseSettings || {}
    };
  }

  // For browser environments, require() doesn't work, so we can't auto-detect
  // Users must use manual injection in browser environments
  throw new Error(
    'Unable to auto-detect ClickHouse client in browser environment. ' +
    'Please use manual injection by providing a client instance:\n\n' +
    '```typescript\n' +
    'import { createClient } from \'@clickhouse/client-web\';\n' +
    'const client = createClient({ host: \'http://localhost:8123\' });\n' +
    'ClickHouseConnection.initialize({ host: \'http://localhost:8123\', client });\n' +
    '```\n\n' +
    'This is required because browser environments cannot use require() to load modules.'
  );
}

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
export class ClickHouseConnection {
  private static instance: ClickHouseClient | null = null;
  private static clientModule: ClickHouseClientModule | null = null;

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
  static initialize(config: ClickHouseConfig): typeof ClickHouseConnection {
    // If a client is explicitly provided, use it directly
    if (isClientConfig(config)) {
      this.instance = config.client;
      return ClickHouseConnection;
    }

    // Otherwise, auto-detect the client (we know we have a host-based config)
    this.clientModule = getClickHouseClientSync();
    this.instance = this.clientModule.createClient(config);
    return ClickHouseConnection;
  }

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
  static getClient(): ClickHouseClient {
    if (!this.instance) {
      throw new Error('ClickHouse connection not initialized. Call ClickHouseConnection.initialize() first.');
    }
    return this.instance;
  }

  /**
   * Gets the ClickHouseSettings type from the loaded client module.
   * Only available when using auto-detection (not manual injection).
   * 
   * @returns The ClickHouseSettings type or an empty object if not available
   */
  static getClickHouseSettings(): ClickHouseSettings {
    return this.clientModule?.ClickHouseSettings || {};
  }
}