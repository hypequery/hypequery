import { createClient } from '@clickhouse/client-web';
import type { ClickHouseSettings } from '@clickhouse/client-web';

// Define a Logger interface matching what the ClickHouse client expects
interface Logger {
  trace(message: string, ...args: any[]): void;
  debug(message: string, ...args: any[]): void;
  info(message: string, ...args: any[]): void;
  warn(message: string, ...args: any[]): void;
  error(message: string, ...args: any[]): void;
}

export interface ClickHouseConnectionOptions {
  host: string;
  username?: string;
  password?: string;
  database?: string;
  http_headers?: Record<string, string>;
  request_timeout?: number;
  compression?: {
    response?: boolean;
    request?: boolean;
  };
  application?: string;
  keep_alive?: {
    enabled: boolean;
  };
  // Using 'any' for the log option to avoid complex type definitions
  log?: any;
  clickhouse_settings?: ClickHouseSettings;
}

export class ClickHouseConnection {
  private static instance: ReturnType<typeof createClient>;

  static initialize(config: ClickHouseConnectionOptions): void {
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
  }

  static getClient(): ReturnType<typeof createClient> {
    if (!this.instance) {
      throw new Error('ClickHouse connection not initialized');
    }
    return this.instance;
  }
} 