import type { ClickHouseClientConfigOptions as NodeClientConfig, ClickHouseSettings as NodeSettings } from '@clickhouse/client';
import type { ClickHouseSettings as WebSettings } from '@clickhouse/client-web';
import type { ClickHouseSettings } from '../../types/clickhouse-settings.js';
import type { ClickHouseConnectionOptions } from '../query-builder.js';

/**
 * Each ClickHouse package has its own nominal SettingsMap class. Passing its
 * toString-compatible values through unchanged preserves existing callers.
 */
export function toClientSettings(settings: ClickHouseSettings): NodeSettings & WebSettings {
  return settings as unknown as NodeSettings & WebSettings;
}

/** Only the settings field differs nominally from the Node client config. */
export function toNodeClientConfig(config: ClickHouseConnectionOptions): NodeClientConfig {
  return config as unknown as NodeClientConfig;
}
