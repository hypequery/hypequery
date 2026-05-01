import type { ClickHouseConfig } from '../query-builder.js';

export function getConnectionEndpoint(config: ClickHouseConfig): string | undefined {
  if ('url' in config && typeof config.url === 'string') {
    return config.url;
  }
  if ('host' in config && typeof config.host === 'string') {
    return config.host;
  }
  return undefined;
}
