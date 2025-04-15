import { createClient } from '@clickhouse/client-web';
import type { ClickHouseSettings } from '@clickhouse/client-web';


/**
 * Configuration options for the ClickHouse connection.
 * 
 * @category Core
 * @example
 * ```typescript
 * const config = {
 *   host: 'http://localhost:8123',
 *   username: 'default',
 *   password: 'password',
 *   database: 'my_database'
 * };
 * ```
 */
export interface ClickHouseConnectionOptions {
  /**
   * The URL of the ClickHouse server, including protocol and port.
   * Example: 'http://localhost:8123' or 'https://your-instance.clickhouse.cloud:8443'
   */
  host: string;

  /**
   * Username for authentication. Defaults to 'default' if not provided.
   */
  username?: string;

  /**
   * Password for authentication.
   */
  password?: string;

  /**
   * The database to connect to. Defaults to 'default' if not provided.
   */
  database?: string;

  /**
   * Enable secure connection (TLS/SSL). 
   * This is automatically set to true if the host URL starts with https://
   */
  secure?: boolean;

  /**
   * Custom HTTP headers to include with each request.
   */
  http_headers?: Record<string, string>;

  /**
   * Request timeout in milliseconds.
   */
  request_timeout?: number;

  /**
   * Compression options for the connection.
   */
  compression?: {
    response?: boolean;
    request?: boolean;
  };

  /**
   * Application name to identify in ClickHouse server logs.
   */
  application?: string;

  /**
   * Keep-alive connection settings.
   */
  keep_alive?: {
    enabled: boolean;
  };

  /**
   * Logger configuration.
   */
  log?: any;

  /**
   * Additional ClickHouse-specific settings.
   */
  clickhouse_settings?: ClickHouseSettings;
}

/**
 * The main entry point for connecting to a ClickHouse database.
 * Provides static methods to initialize the connection and retrieve the client.
 * 
 * @category Core
 * @example
 * ```typescript
 * // Initialize the connection
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
 */
export class ClickHouseConnection {
  private static instance: ReturnType<typeof createClient>;

  /**
   * Initializes the ClickHouse connection with the provided configuration.
   * This method must be called before any queries can be executed.
   * 
   * @param config - The connection configuration options
   * @returns The ClickHouseConnection class for method chaining
   * @throws Will throw an error if the connection cannot be established
   * 
   * @example
   * ```typescript
   * // For a local ClickHouse instance
   * ClickHouseConnection.initialize({
   *   host: 'http://localhost:8123',
   *   username: 'default',
   *   password: 'password',
   *   database: 'my_database'
   * });
   * ```
   */
  static initialize(config: ClickHouseConnectionOptions): typeof ClickHouseConnection {
    // Create a client config object with only the standard options
    const clientConfig: any = {
      host: config.host,
      username: config.username,
      password: config.password,
      database: config.database,
    };

    // Add the extended options if provided
    if (config.http_headers) clientConfig.http_headers = config.http_headers;
    if (config.request_timeout) clientConfig.request_timeout = config.request_timeout;
    if (config.compression) clientConfig.compression = config.compression;
    if (config.application) clientConfig.application = config.application;
    if (config.keep_alive) clientConfig.keep_alive = config.keep_alive;
    if (config.log) clientConfig.log = config.log;
    if (config.clickhouse_settings) clientConfig.clickhouse_settings = config.clickhouse_settings;

    this.instance = createClient(clientConfig);
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
  static getClient(): ReturnType<typeof createClient> {
    if (!this.instance) {
      throw new Error('ClickHouse connection not initialized');
    }
    return this.instance;
  }
} 