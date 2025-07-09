import type { ClickHouseSettings } from '@clickhouse/client-common';
import type { ClickHouseClient as NodeClickHouseClient } from '@clickhouse/client';
import type { ClickHouseClient as WebClickHouseClient } from '@clickhouse/client-web';
import type { ClickHouseConfig, ClickHouseHostConfig } from './query-builder';
import { isClientConfig, isHostConfig } from './query-builder';

// Union type that accepts either client type
type ClickHouseClient = NodeClickHouseClient | WebClickHouseClient;

interface ClickHouseClientModule {
  createClient: (config: ClickHouseConfig) => ClickHouseClient;
  ClickHouseSettings?: ClickHouseSettings;
}

// Function to synchronously get the appropriate client with fallback
function getClickHouseClientSync(): ClickHouseClientModule {
  const isDev = process.env.NODE_ENV === 'development';
  const isNode = typeof process !== 'undefined' && process.versions && process.versions.node;

  // In Node.js environment, try Node.js client first, then fallback to web client
  if (isNode) {
    try {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const clientNode = require('@clickhouse/client');
      if (isDev) {
        console.log('hypequery: Using @clickhouse/client for Node.js environment');
      }
      return {
        createClient: clientNode.createClient,
        ClickHouseSettings: clientNode.ClickHouseSettings || {}
      };
    } catch (error) {
      // Fallback to web client in Node.js
      try {
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        const clientWeb = require('@clickhouse/client-web');
        if (isDev) {
          console.log('hypequery: Using @clickhouse/client-web (Node.js client not available)');
        }
        return {
          createClient: clientWeb.createClient,
          ClickHouseSettings: clientWeb.ClickHouseSettings || {}
        };
      } catch (webError) {
        throw new Error(
          'No ClickHouse client found. Please install one of the following:\n' +
          '- @clickhouse/client (recommended for Node.js environments)\n' +
          '- @clickhouse/client-web (for browser/universal environments)\n\n' +
          'Install with: npm install @clickhouse/client or npm install @clickhouse/client-web\n\n' +
          'Alternatively, you can provide a client instance directly in the config.client option.'
        );
      }
    }
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

// Helper function to create client config from connection options
function createClientConfig(config: ClickHouseConfig): ClickHouseConfig {
  // If a client is provided, we don't need to create a config
  if (isClientConfig(config)) {
    return {} as ClickHouseConfig;
  }

  // At this point, we know we have a host-based config
  if (!isHostConfig(config)) {
    throw new Error('Invalid configuration: must provide either host or client');
  }

  const clientConfig: ClickHouseConfig = {
    host: config.host,
    username: config.username,
    password: config.password,
    database: config.database,
  };

  // Add optional configuration if provided
  const optionalProps = [
    'http_headers',
    'request_timeout',
    'compression',
    'application',
    'keep_alive',
    'log',
    'clickhouse_settings'
  ] as const;

  for (const prop of optionalProps) {
    if (config[prop] !== undefined) {
      clientConfig[prop] = config[prop];
    }
  }

  return clientConfig;
}

/**
 * The main entry point for connecting to a ClickHouse database.
 * Provides static methods to initialize the connection and retrieve the client.
 * 
 * Supports two modes of operation:
 * 1. **Manual injection**: Provide a client instance via `config.client` (required for browser environments)
 * 2. **Auto-detection with fallback**: Automatically selects the best client for Node.js environments
 *    - Tries @clickhouse/client first, falls back to @clickhouse/client-web
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
 * - @clickhouse/client (recommended for Node.js environments)
 * - @clickhouse/client-web (for browser/universal environments)
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
   * 2. Otherwise, auto-detect the best client for Node.js environments:
   *    - Tries @clickhouse/client first, falls back to @clickhouse/client-web
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
    this.instance = this.clientModule.createClient(createClientConfig(config));
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