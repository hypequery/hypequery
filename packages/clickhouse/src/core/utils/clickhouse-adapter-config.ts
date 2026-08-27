import type { ClickHouseClient as NodeClickHouseClient } from '@clickhouse/client';
import type { ClickHouseClient as WebClickHouseClient } from '@clickhouse/client-web';
import type { ClickHouseAdapterConfig } from '../query-builder.js';
import { isClientConfig } from '../query-builder.js';
import { getAutoClientModule } from '../env/auto-client.js';
import type { AutoClientModule } from '../env/auto-client.js';
import { getConnectionEndpoint } from './connection-endpoint.js';

export type ClickHouseClient = NodeClickHouseClient | WebClickHouseClient;

export function createClickHouseClient(config: ClickHouseAdapterConfig): ClickHouseClient {
  if (isClientConfig(config)) {
    return config.client;
  }

  const clientModule: AutoClientModule = getAutoClientModule();
  const { integerJsonEncoding: _adapterOption, ...clientConfig } = config;
  return clientModule.createClient(clientConfig);
}

export function deriveClickHouseNamespace(config: ClickHouseAdapterConfig): string {
  if ('client' in config && config.client) {
    return 'client';
  }

  const endpoint = getConnectionEndpoint(config);
  const database = 'database' in config ? config.database : 'default';
  const username = 'username' in config ? config.username : 'default';
  return `${endpoint || 'unknown-host'}|${database || 'default'}|${username || 'default'}`;
}
